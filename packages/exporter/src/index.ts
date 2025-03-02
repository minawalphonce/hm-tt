import path from "node:path";
import { program } from "commander";

import handler from "./images-handler";


program
    .name("export")
    .description("transform data using template")

program
    .description("export template")
    .argument("<batch>", "the batch number of product ids or path to file containing product ids")
    .option("-o, --output <output>", "output type [json, xlsx, console]", "xlsx")
    .option("-p, --path <path>", "output relative to the current folder", arg => arg && path.resolve(__dirname, arg))
    .option("-s, --seasons <seasons>", "list of comma separated season numbers", arg => arg.split(","), ["202502", "202501", "202410", "202409", "202308", "202307"])
    .action(async (arg, options) => {
        await handler({
            "outputType": options.output,
            "outPath": options.path || path.resolve(__dirname, `../../../data/batch${arg}/export${arg}.${options.output}`),
            "seasons": options.seasons,
            "locale": "en-IN",
            "batchNumber": arg
        })
    });

await program.parseAsync(process.argv);