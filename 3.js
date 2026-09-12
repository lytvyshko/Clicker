import koffi from "koffi";
import { Region, screen } from "@nut-tree-fork/nut-js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const total = Number(process.argv[2]);
let ready = 0;
let mirages = Number(process.argv[3]);
let success = 0;

if (!Number.isInteger(total) || total <= 0) {
    throw new Error("Потрібно передати додатне ціле значення total.");
}

if (!Number.isInteger(mirages) || mirages < 0) {
    throw new Error("Потрібно передати невід'ємне ціле значення mirages.");
}

const minIntervalMs = 2100;
const maxIntervalMs = 2400;
const meanIntervalMs = (minIntervalMs + maxIntervalMs) / 2;
const stdDevMs = (maxIntervalMs - minIntervalMs) / 6;
const clickJitterPx = 4;

// --- Fatigue-модель: параметри "ігрової сесії" ---
const sessionMinMs = 40 * 60 * 1000;   // мінімальна тривалість сесії: 40 хв
const sessionMaxMs = 100 * 60 * 1000;   // максимальна тривалість сесії: 100 хв
const breakMinMs = 5 * 60 * 1000;          // мінімальна перерва: 5 хв
const breakMaxMs = 20 * 60 * 1000;      // максимальна перерва: 20 хв

// Область перевірки задається координатами екрана: left, top, width, height.
const colorRegion = new Region(1646, 846, 165, 21);
const targetColor = { R: 2, G: 191, B: 7 }; // зелений
const colorTolerance = 25;

const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const MK_LBUTTON = 0x0001;
const WM_RBUTTONDOWN = 0x0204;
const WM_RBUTTONUP = 0x0205;
const MK_RBUTTON = 0x0002;

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
            console.log(paused ? "⏸ Скрипт поставлено на паузу" : "▶ Скрипт продовжено");
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

        const chunkStartedAt = Date.now();
        await sleep(Math.min(100, remainingMs));
        remainingMs -= Date.now() - chunkStartedAt;
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

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * Інтервал між кліками з урахуванням "втоми" — наскільки далеко ми
 * зайшли у поточну сесію (0 = щойно почали, 1 = кінець сесії).
 * Ближче до кінця сесії людина клікає трохи повільніше й нерівномірніше.
 */
function randomInterval() {
    let interval = gaussianRandom(meanIntervalMs, stdDevMs);

    // зрідка (~3%) імітуємо "відволікання" — довша пауза
    if (Math.random() < 0.03) {
        interval += Math.random() * 3000 + 1000; // +1-4 секунд
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

function backgroundLeftClick(windowHandle, x, y) {
    const lParam = makeMouseLParam(x, y);
    PostMessageW(windowHandle, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
    PostMessageW(windowHandle, WM_LBUTTONUP, 0, lParam);
}

function backgroundRightClick(windowHandle, x, y) {
    const lParam = makeMouseLParam(x, y);
    PostMessageW(windowHandle, WM_RBUTTONDOWN, MK_RBUTTON, lParam);
    PostMessageW(windowHandle, WM_RBUTTONUP, 0, lParam);
}

function colorMatches(red, green, blue) {
    return Math.abs(red - targetColor.R) <= colorTolerance &&
        Math.abs(green - targetColor.G) <= colorTolerance &&
        Math.abs(blue - targetColor.B) <= colorTolerance;
}

async function hasTargetColor(region) {
    const image = await screen.grabRegion(region);
    const { data, channels, colorMode } = image;

    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
            const offset = (y * image.width + x) * channels;
            const first = data[offset];
            const second = data[offset + 1];
            const third = data[offset + 2];

            const red = colorMode === 0 ? third : first;
            const green = second;
            const blue = colorMode === 0 ? first : third;

            if (colorMatches(red, green, blue)) {
                return true;
            }
        }
    }

    return false;
}

function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes} хв ${seconds} сек`;
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

    backgroundRightClick(targetWindow, screenPoint.x, screenPoint.y);
    await sleep(1000);

    terminal.close();

    console.log(`Фонові кліки у координатах вікна: (${screenPoint.x}, ${screenPoint.y})`);
    console.log("F8 — пауза/продовження, Ctrl+C — завершити");

    const pauseHotkeyTimer = startPauseHotkey();

    // --- нова "ігрова сесія" ---
    let sessionDuration = randomBetween(sessionMinMs, sessionMaxMs);
    let sessionStart = Date.now();
    let sessionEnd = sessionStart + sessionDuration;


    console.log(`\n▶ Нова сесія: ~${formatDuration(sessionDuration)}`);

    while (success <= 3) {
        if (success === 3) {
            ready++;
            await waitUntilResumed();
            backgroundLeftClick(targetWindow, 1762, 543);
            success = 0;

            if (ready === total) {
                console.log("Успіх, всі шмотки заточені!");
                break;
            }

            if (mirages < 250) {
                console.log('Замало міражів, процес призупинено');
                break;
            }

            if (ready % 8 === 0) {
                screenPoint.x -= 260;
                screenPoint.y += 38;
            } else {
                screenPoint.x += 37;
            }

            await pauseAwareSleep(2000);

            if (Date.now() > sessionEnd) {
                const breakDuration = randomBetween(breakMinMs, breakMaxMs);
                console.log(`⏸ Перерва: ~${formatDuration(breakDuration)}`);
                await pauseAwareSleep(breakDuration);

                sessionDuration = randomBetween(sessionMinMs, sessionMaxMs);
                sessionStart = Date.now();
                sessionEnd = sessionStart + sessionDuration;
            }

            await waitUntilResumed();
            backgroundRightClick(targetWindow, screenPoint.x, screenPoint.y);

            await pauseAwareSleep(2000);
        }

        const jitteredX = jitterCoordinate(1760, clickJitterPx);
        const jitteredY = jitterCoordinate(911, clickJitterPx);

        await waitUntilResumed();
        backgroundLeftClick(targetWindow, jitteredX, jitteredY);
        mirages--;

        const interval = randomInterval();

        console.log(`інтервал ${interval}мс`);
        await pauseAwareSleep(interval);

        const colorFound = await hasTargetColor(colorRegion);
        if (colorFound) {
            success++
        } else {
            success = 0
        }
    }

    clearInterval(pauseHotkeyTimer);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
