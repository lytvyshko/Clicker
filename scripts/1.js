import koffi from "koffi";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const minIntervalMs = 3900;
const maxIntervalMs = 4050;
const meanIntervalMs = (minIntervalMs + maxIntervalMs) / 2;
const stdDevMs = (maxIntervalMs - minIntervalMs) / 6;

const clickJitterPx = 5;// максимальне відхилення кліку від базової точки, px

const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const MK_LBUTTON = 0x0001;

const user32 = koffi.load("user32.dll");
const POINT = koffi.struct("POINT", { x: "long", y: "long" });
const HWND = "void *";

const GetCursorPos = user32.func("__stdcall", "GetCursorPos", "bool", [
    koffi.out(koffi.pointer(POINT)),
]);
const WindowFromPoint = user32.func("__stdcall", "WindowFromPoint", HWND, [POINT]);
const GetAncestor = user32.func("__stdcall", "GetAncestor", HWND, [HWND, "uint"]);
const ScreenToClient = user32.func("__stdcall", "ScreenToClient", "bool", [
    HWND,
    koffi.inout(koffi.pointer(POINT)),
]);
const PostMessageW = user32.func("__stdcall", "PostMessageW", "bool", [HWND, "uint", "uintptr", "intptr"]);
const GetAsyncKeyState = user32.func("__stdcall", "GetAsyncKeyState", "int16", ["int"]);

const GA_ROOT = 2;
const VK_F8 = 0x77;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let paused = false;

function startPauseHotkey() {
    let wasPressed = false;

    return setInterval(() => {
        const isPressed = (GetAsyncKeyState(VK_F8) & 0x8000) !== 0;

        if (isPressed && !wasPressed) {
            paused = !paused;
            console.log(paused ? "Paused" : "Resumed");
        }

        wasPressed = isPressed;
    }, 50);
}

async function pauseAwareSleep(durationMs) {
    let remainingMs = durationMs;

    while (remainingMs > 0) {
        if (paused) {
            await sleep(100);
            continue;
        }

        const startedAt = Date.now();
        await sleep(Math.min(100, remainingMs));
        remainingMs -= Date.now() - startedAt;
    }
}

async function waitUntilResumed() {
    while (paused) {
        await sleep(100);
    }
}

function gaussianRandom(mean, stdDev) {
    let u1 = Math.random();
    let u2 = Math.random();
    while (u1 === 0) u1 = Math.random();

    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
}

function randomInterval() {
    let interval = gaussianRandom(meanIntervalMs, stdDevMs);

    // зрідка (~3%) імітуємо "відволікання" — довша пауза
    if (Math.random() < 0.03) {
        interval += Math.random() * 1000 + 3000; // +3-4 секунд
    }

    return Math.max(minIntervalMs, Math.floor(interval));
}

/**
 * Невелике випадкове відхилення координати кліку від базової точки.
 * Використовує gaussian, щоб більшість кліків лягали ближче до центру,
 * а рідкісні — ближче до країв діапазону (реалістичніше за uniform).
 */
function jitterCoordinate(base, maxOffsetPx) {
    // stdDev підібраний так, щоб ~99.7% значень вклались у ±maxOffsetPx
    const stdDev = maxOffsetPx / 3;
    const offset = gaussianRandom(0, stdDev);
    const clamped = Math.max(-maxOffsetPx, Math.min(maxOffsetPx, offset));
    return Math.round(base + clamped);
}

function makeMouseLParam(x, y) {
    return (x & 0xffff) | ((y & 0xffff) << 16);
}

function backgroundClick(windowHandle, x, y) {
    console.log(`Клік у ${x}, ${y} `);
    const lParam = makeMouseLParam(x, y);
    PostMessageW(windowHandle, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
    PostMessageW(windowHandle, WM_LBUTTONUP, 0, lParam);
}

async function main() {
    const terminal = readline.createInterface({ input, output });

    await terminal.question(
        "Наведіть курсор на потрібне місце в грі й натисніть Enter..."
    );

    const screenPoint = { x: 0, y: 0 };
    if (!GetCursorPos(screenPoint)) {
        terminal.close();
        throw new Error("Не вдалося визначити позицію курсора.");
    }

    const windowUnderCursor = WindowFromPoint(screenPoint);
    const targetWindow = windowUnderCursor
        ? GetAncestor(windowUnderCursor, GA_ROOT)
        : null;

    if (!targetWindow) {
        terminal.close();
        throw new Error("Не вдалося визначити вікно під курсором.");
    }

    const clientPoint = { x: screenPoint.x, y: screenPoint.y };
    if (!ScreenToClient(targetWindow, clientPoint)) {
        terminal.close();
        throw new Error("Не вдалося перетворити координати у координати вікна.");
    }

    terminal.close();

    console.log(`Фонові кліки у координатах вікна: (${clientPoint.x}, ${clientPoint.y})`);
    console.log("F8 — pause/resume, Ctrl+C — stop");

    startPauseHotkey();

    let totalClicks = 0;

    while (true) {
        await waitUntilResumed();

        const jitteredX = jitterCoordinate(clientPoint.x, clickJitterPx);
        const jitteredY = jitterCoordinate(clientPoint.y, clickJitterPx);
        backgroundClick(targetWindow, jitteredX, jitteredY);
        totalClicks += 1;

        const interval = randomInterval();
        console.log(`клік #${totalClicks}, інтервал ${interval}мс`);
        await pauseAwareSleep(interval);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
