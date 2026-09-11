import koffi from "koffi";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const minIntervalMs = 3600;
const maxIntervalMs = 4100;
const meanIntervalMs = (minIntervalMs + maxIntervalMs) / 2; // 4050
const stdDevMs = (maxIntervalMs - minIntervalMs) / 6; // ~150

// --- Fatigue-модель: параметри "ігрової сесії" ---
const sessionMinMs = 15 * 60 * 1000;   // мінімальна тривалість сесії: 15 хв
const sessionMaxMs = 40 * 60 * 1000;   // максимальна тривалість сесії: 40 хв
const breakMinMs = 60 * 1000;          // мінімальна перерва: 1 хв
const breakMaxMs = 8 * 60 * 1000;      // максимальна перерва: 8 хв
const fatigueMaxSlowdown = 0.25;       // під кінець сесії інтервали зростають до +25%
const clickJitterPx = 5;               // максимальне відхилення кліку від базової точки, px

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

const GA_ROOT = 2;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
function randomInterval(fatigueRatio = 0) {
    // втома трохи зсуває середнє і збільшує розкид
    const fatigueFactor = 1 + fatigueMaxSlowdown * fatigueRatio;
    const adjustedMean = meanIntervalMs * fatigueFactor;
    const adjustedStdDev = stdDevMs * (1 + 0.5 * fatigueRatio);

    let interval = gaussianRandom(adjustedMean, adjustedStdDev);

    // зрідка (~3%) імітуємо "відволікання" — довша пауза
    if (Math.random() < 0.03) {
        interval += Math.random() * 8000 + 4000; // +4-12 секунд
    }

    // зрідка (~2%) невелике прискорення, але без виходу за межі кулдауну
    if (Math.random() < 0.02) {
        interval *= 0.85;
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

    const clientPoint = { x: screenPoint.x, y: screenPoint.y };
    if (!ScreenToClient(targetWindow, clientPoint)) {
        terminal.close();
        throw new Error("Не вдалося перетворити координати у координати вікна.");
    }

    terminal.close();

    console.log(`Фонові кліки у координатах вікна: (${clientPoint.x}, ${clientPoint.y})`);

    let totalClicks = 0;

    while (true) {
        // --- нова "ігрова сесія" ---
        const sessionDuration = randomBetween(sessionMinMs, sessionMaxMs);
        const sessionStart = Date.now();
        const sessionEnd = sessionStart + sessionDuration;

        console.log(`\n▶ Нова сесія: ~${formatDuration(sessionDuration)}`);

        while (Date.now() < sessionEnd) {
            const jitteredX = jitterCoordinate(clientPoint.x, clickJitterPx);
            const jitteredY = jitterCoordinate(clientPoint.y, clickJitterPx);
            backgroundClick(targetWindow, jitteredX, jitteredY);
            totalClicks += 1;

            // наскільки глибоко ми в сесії (0..1), впливає на "втому"
            const fatigueRatio = Math.min(1, (Date.now() - sessionStart) / sessionDuration);
            const interval = randomInterval(fatigueRatio);

            console.log(`клік #${totalClicks}, інтервал ${interval}мс, втома ${(fatigueRatio * 100).toFixed(0)}%`);
            await sleep(interval);
        }

        // --- перерва на "перепочити" ---
        const breakDuration = randomBetween(breakMinMs, breakMaxMs);
        console.log(`⏸ Перерва: ~${formatDuration(breakDuration)}`);
        await sleep(breakDuration);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});