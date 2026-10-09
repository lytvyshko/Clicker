import koffi from "koffi";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const minIntervalMs = 400;
const maxIntervalMs = 1400;

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
const PostMessageW = user32.func("__stdcall", "PostMessageW", "bool", [
    HWND,
    "uint",
    "uintptr",
    "intptr",
]);
const GetAsyncKeyState = user32.func("__stdcall", "GetAsyncKeyState", "int16", ["int"]);

const GA_ROOT = 2;
const VK_F10 = 0x79;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let paused = false;

function startPauseHotkey() {
    let wasPressed = false;

    return setInterval(() => {
        const isPressed = (GetAsyncKeyState(VK_F10) & 0x8000) !== 0;

        if (isPressed && !wasPressed) {
            paused = !paused;
            console.log(paused ? "Paused" : "Resumed");
        }

        wasPressed = isPressed;
    }, 50);
}

// Compatibility alias for the alternate capitalization.
const startPauseHotKey = startPauseHotkey;

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

function makeMouseLParam(x, y) {
    return (x & 0xffff) | ((y & 0xffff) << 16);
}

function backgroundLeftClick(windowHandle, x, y) {
    const lParam = makeMouseLParam(x, y);
    PostMessageW(windowHandle, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
    PostMessageW(windowHandle, WM_LBUTTONUP, 0, lParam);
}

function randomInterval() {
    let interval = Math.floor(
        Math.random() * (maxIntervalMs - minIntervalMs + 1) + minIntervalMs
    );

    if (Math.random() < 0.03) {
        const distraction = Math.floor(Math.random() * 3000 + 1000);
        interval += distraction;
        console.log(`Distraction pause: +${distraction} ms`);
    }

    return interval;
}

async function main() {
    const terminal = readline.createInterface({ input, output });

    await terminal.question(
        "Move the cursor to the target point and press Enter..."
    );

    const screenPoint = { x: 0, y: 0 };
    if (!GetCursorPos(screenPoint)) {
        terminal.close();
        throw new Error("Could not determine the cursor position.");
    }

    const windowUnderCursor = WindowFromPoint(screenPoint);
    const targetWindow = windowUnderCursor
        ? GetAncestor(windowUnderCursor, GA_ROOT)
        : null;

    if (!targetWindow) {
        terminal.close();
        throw new Error("Could not determine the window under the cursor.");
    }

    const clientPoint = { x: screenPoint.x, y: screenPoint.y };
    if (!ScreenToClient(targetWindow, clientPoint)) {
        terminal.close();
        throw new Error("Could not convert the point to window coordinates.");
    }

    terminal.close();

    console.log("Press F10 to pause/resume, Ctrl+C to stop.");

    startPauseHotkey();

    let totalClicks = 0;

    while (true) {
        await waitUntilResumed();
        backgroundLeftClick(targetWindow, clientPoint.x, clientPoint.y);
        totalClicks += 1;

        const interval = randomInterval();

        await pauseAwareSleep(interval);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
