import fs from "fs";
import { EOL } from "os";
import path from "path";
import ejs from "ejs";
import ExcelJS from "exceljs";
import axios from "axios";
//import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";

import "dotenv/config";

import { Task, runTasks } from "./task-runner";

type TaskParams = {
    outputType: "json" | "xlsx" | "concole";
    outPath: string;
    seasons: string[],
    locale: string,
    batchNumber: number;
}

type TaskContext = Partial<{
    ids: string[];
    article: any;
    //articles: { articleId: string, variantIds: string[] }[];
    token: string;
    writter: fs.WriteStream;
    workbook: ExcelJS.stream.xlsx.WorkbookWriter;
    worksheet: ExcelJS.Worksheet;
    chunk: string;
    //containerClient: ContainerClient,
    count: number;
    //missingIds: string[];
}>;

function groupByPrefix(numbers: string[], prefixLength = 10) {
    // Initialize an empty object to store the grouped numbers
    const grouped: Record<string, string[]> = {};

    // Iterate through each number in the array
    for (const number of numbers) {
        // Convert to string to ensure we can extract characters
        const numString = String(number);

        // Extract the prefix (first 10 characters by default)
        const prefix = numString.substring(0, prefixLength);

        // If this prefix doesn't exist in our grouped object yet, create an empty array for it
        if (!grouped[prefix]) {
            grouped[prefix] = [];
        }

        // Add the current number to the appropriate group
        grouped[prefix].push(numString);
    }

    return grouped;
}

const tasks: Task<TaskParams, TaskContext>[] = [
    {
        title: "load Ids From File",
        async action(params: TaskParams, ctx: TaskContext) {
            const ids = fs.readFileSync(path.resolve(
                __dirname,
                `../../../data/batch${params.batchNumber}/abatch${params.batchNumber}`)).toString();
            ctx.ids = ids.split(EOL);
            //ctx.missingIds = [];
        }
    },
    {
        title: "initialize Writter",
        async action(params: TaskParams, ctx: TaskContext) {
            console.log("[output]", params.outPath, params.outputType);
            if (params.outputType === "json") {
                ctx.writter = fs.createWriteStream(params.outPath, { encoding: "utf-8" });
                ctx.writter.write("[\n");
            }
            else if (params.outputType === "xlsx") {
                ctx.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
                    "filename": params.outPath,
                })
                ctx.worksheet = ctx.workbook.addWorksheet("Articles");
            }
        }
    },
    {
        "title": "authenticate with api",
        async action(params: TaskParams, ctx: TaskContext) {
            const response = await axios.postForm("https://login.windows.net/30f52344-4663-4c2e-bab3-61bf24ebbed8/oauth2/token", {
                'grant_type': 'client_credentials',
                'client_id': process.env.client_id,
                'client_secret': process.env.client_secret,
                'resource': 'f832f9fc-73ce-4957-9c28-f0fba6a28812'
            });

            const token = response.data.access_token
            ctx.token = token;
        }
    },
    {
        title: "render template",
        async action(params: TaskParams, ctx: TaskContext, executeSubTasks: (article: string, variant: string) => Promise<void>) {
            const articles = groupByPrefix(ctx.ids!);
            ctx.count = ctx.ids!.length || 0;
            for (const [id, variants] of Object.entries(articles)) {
                for (const variant of variants) {
                    await executeSubTasks(id, variant);
                }
            }
        },
        children: [
            {
                title: (_, __, [id]) => {
                    return `fetching article ${id} from api`;
                },
                async action(params: TaskParams, ctx: TaskContext, [id]: any[]) {
                    const result = await axios.get(`https://gateway.hapi.hmgroup.com/omni-product/api/v2/brands/0/season-merged/articles/${id}`,
                        {
                            headers: {
                                "Authorization": `Bearer ${ctx.token}`,
                                "Ocp-Apim-Subscription-Key": "10e5e01d606e45368faef7d263d5dacd"
                            },
                            params: {
                                channelIds: 2,
                                blocks: "asset",
                                salesmarkets: "IN",
                                seasons: params.seasons.join(","),
                                locales: "en-GB"
                            }
                        });
                    ctx.count = ctx.count! - 1;
                    ctx.article = result.data;
                }
            },
            {
                title: (_, ctx, [id]) => {
                    return `rendering article ${id} - ${ctx["count"]} remaining`;
                },
                async action(params: TaskParams, ctx: TaskContext, [id, variant]: any[]) {
                    if (ctx.article === undefined) {
                        return;
                    }
                    const templatePath = path.resolve(__dirname, "templates/ejs/assets.ejs");
                    const templateFile = fs.readFileSync(templatePath, "utf-8");
                    const result = ejs.render(templateFile, {
                        article: ctx.article,
                        variant: variant,
                        ...params
                    }, {
                        views: [path.resolve(__dirname, "templates/ejs")]
                    });
                    ctx.chunk = result;
                }
            },
            {
                title: (_, __, [id]) => {
                    return `save article ${id} to file`;
                },
                async action(params: TaskParams, ctx: TaskContext) {
                    if (ctx.chunk === undefined) {
                        return;
                    }
                    if (params.outputType === "json") {
                        ctx.writter?.write(ctx.chunk, "utf-8");
                    }
                    else if (params.outputType === "xlsx") {
                        const arrOfRows = JSON.parse("[" + ctx.chunk + "null]" || "[]");
                        if (ctx.worksheet?.columns === null) {
                            const levels = Object.keys(arrOfRows[0]);
                            const headers: string[] = levels; //[];
                            //let colIndex = 0;
                            //for (const level of levels) {
                            //     const levelHeaders = Object.keys(arrOfRows[0][level]);
                            //     ctx.worksheet.mergeCells(1, colIndex + 1, 1, colIndex + levelHeaders.length);
                            //     const cell = ctx.worksheet.getCell(1, colIndex + 1);
                            //     cell.value = level;
                            //     colIndex = colIndex + levelHeaders.length;
                            //     headers.push(...levelHeaders);
                            // }
                            // ctx.worksheet.getRow(1).commit();
                            ctx.worksheet.addRow(headers).commit();
                        }

                        arrOfRows.forEach((row: any) => {
                            if (row !== null)
                                ctx.worksheet?.addRow(
                                    Object.values(row)
                                    // Object.values(row).flatMap((level: any) => {
                                    //     return Object.values(level);
                                    // })
                                ).commit();
                        });
                    }
                }
            }
        ]
    },
    // {
    //     title: "missing products",
    //     async action(params: TaskParams, ctx: TaskContext) {
    //         console.log("[missing products]", ctx.missingIds);
    //         fs.writeFileSync(path.resolve(__dirname, `../../../data/batch${params.batchNumber}/missing`), ctx.missingIds!.join(EOL));
    //     }
    // },
    {
        title: "cleanup",
        async action(params: TaskParams, ctx: TaskContext) {
            if (params.outputType === "json") {
                ctx.writter?.write("{}]\n");
                ctx.writter?.close();
            }
            else if (params.outputType === "xlsx") {
                ctx.workbook?.commit();
            }
        }

    }
];

export default async function handler(params: TaskParams) {
    await runTasks(params, tasks);
}
