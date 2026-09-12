import koffi from "koffi";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const total = 20;
const price = process.argv[2];

if (!price || !/^\d+$/.test(price)) {
    throw new Error("Потрібно передати ціну як число.");
}

const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONDOWN = 0x0204;
const WM_RBUTTONUP = 0x0205;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const MK_LBUTTON = 0x0001;
const MK_RBUTTON = 0x0002;
const VK_BACK = 0x08;

const user32 = koffi.load("user32.dll");
const POINT = koffi.struct("POINT", { x: "long", y: "long" });
const HWND = "void *";

const GetCursorPos = user32.func("__stdcall", "GetCursorPos", "bool", [
    koffi.out(koffi.pointer(POINT)),
]);
const WindowFromPoint = user32.func("__stdcall", "WindowFromPoint", HWND, [POINT]);
const GetAncestor = user32.func("__stdcall", "GetAncestor", HWND, [HWND, "uint"]);
const PostMessageW = user32.func("__stdcall", "PostMessageW", "bool", [
    HWND,
    "uint",
    "uintptr",
    "intptr",
]);

const GA_ROOT = 2;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

function backgroundKey(windowHandle, virtualKey) {
    PostMessageW(windowHandle, WM_KEYDOWN, virtualKey, 1);
    PostMessageW(windowHandle, WM_KEYUP, virtualKey, 0xC0000001);
}

async function bindToWindow(terminal) {
    await terminal.question(
        "Наведіть курсор на потрібне вікно й натисніть Enter..."
    );

    const screenPoint = { x: 0, y: 0 };
    if (!GetCursorPos(screenPoint)) {
        throw new Error("Не вдалося визначити позицію курсора.");
    }

    const windowUnderCursor = WindowFromPoint(screenPoint);
    const targetWindow = windowUnderCursor
        ? GetAncestor(windowUnderCursor, GA_ROOT)
        : null;

    if (!targetWindow) {
        throw new Error("Не вдалося визначити вікно під курсором.");
    }

    return targetWindow;
}

async function runOnce(targetWindow) {

    let x = 24;
    let y = 67;
    let ready = 0;

    while (ready < total) {
        backgroundLeftClick(targetWindow, x, y);
        ready += 1;

        if (ready % 5 === 0) {
            x -= 132;
            y += 32;
        } else {
            x += 33;
        }
    }

    ready = 0;
    x = 1638;
    y = 298;

    while (ready < total) {
        backgroundRightClick(targetWindow, x, y);

        backgroundKey(targetWindow, VK_BACK);
        await sleep(50);
        backgroundKey(targetWindow, VK_BACK);
        await sleep(50);
        backgroundKey(targetWindow, VK_BACK);
        await sleep(50);

        for (const digit of price) {
            backgroundKey(targetWindow, 0x30 + Number(digit));
            await sleep(50);
        }

        await sleep(50);
        backgroundLeftClick(targetWindow, 929, 838);
        ready += 1;

        if (ready % 8 === 0) {
            x -= 232;
            y += 40;
        } else {
            x += 33;
        }
    }
}

async function main() {
    const terminal = readline.createInterface({ input, output });

    try {
        while (true) {
            const targetWindow = await bindToWindow(terminal);
            await runOnce(targetWindow);

            console.log(`\nГотово. Ціна ${price} залишилась тією самою.`);
            console.log("Для нового запуску наведіть курсор на потрібне вікно й натисніть Enter.");
        }
    } finally {
        terminal.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
