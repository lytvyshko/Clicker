import { mouse, Button, Point } from "@nut-tree-fork/nut-js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const intervalMs = 3800; // пауза між кліками

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const terminal = readline.createInterface({ input, output });

    await terminal.question(
        "Наведіть курсор на потрібне місце й натисніть Enter для визначення координат..."
    );

    const position = await mouse.getPosition();
    terminal.close();

    const { x, y } = position;

    console.log(`Клікання по координатах (${x}, ${y})`);
    console.log("Клікер працює без обмеження кількості кліків.");
    console.log("Для аварійної зупинки натисніть Ctrl+C");

    let totalClicks = 0;

    while (true) {
        await mouse.setPosition(new Point(x, y));
        await mouse.click(Button.LEFT);

        totalClicks += 1;
        console.log(`Клік ${totalClicks}`);
        await sleep(intervalMs);
    }
}

main().catch(console.error);
