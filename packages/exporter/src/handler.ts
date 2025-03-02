import fs from "fs";
import { EOL } from "os";
import path from "path";
import ejs from "ejs";
import ExcelJS from "exceljs";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";

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
    product: any;
    //articles: { articleId: string, variantIds: string[] }[];
    token: string;
    writter: fs.WriteStream;
    workbook: ExcelJS.stream.xlsx.WorkbookWriter;
    worksheet: ExcelJS.Worksheet;
    chunk: string;
    containerClient: ContainerClient,
    count: number;
    missingIds: string[];
}>;

const tasks: Task<TaskParams, TaskContext>[] = [
    {
        title: "load Ids From File",
        async action(params: TaskParams, ctx: TaskContext) {
            const ids = fs.readFileSync(path.resolve(
                __dirname,
                `../../../data/batch${params.batchNumber}/batch${params.batchNumber}`)).toString();
            ctx.ids = ids.split(EOL);
            ctx.missingIds = [];
        }
    },
    {
        title: "initialize Writter",
        async action(params: TaskParams, ctx: TaskContext) {
            if (params.outputType === "json") {
                ctx.writter = fs.createWriteStream(params.outPath, { encoding: "utf-8" });
                ctx.writter.write("[\n");
            }
            else if (params.outputType === "xlsx") {
                ctx.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
                    "filename": params.outPath,
                })
                ctx.worksheet = ctx.workbook.addWorksheet("Products");
            }
        }
    },
    {
        title: "render template",
        async action(params: TaskParams, ctx: TaskContext, executeSubTasks: (product: string) => Promise<void>) {
            const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_BLOB_CONNECTION_STRING!);
            const containerClient = blobServiceClient.getContainerClient("hm-india-online-ajo");
            ctx.containerClient = containerClient;
            //ctx.articles = [];
            for (const id of ctx.ids!) {
                await executeSubTasks(id);
            }
            ctx.count = ctx.ids?.length || 0;
        },
        children: [
            {
                title: (_, __, [id]) => {
                    return `fetching product ${id} from api`;
                },
                async action(params: TaskParams, ctx: TaskContext, [id]: any[]) {
                    try {
                        const buffer = await ctx.containerClient!.getBlobClient(`enriched/${id}`).downloadToBuffer();
                        const data = JSON.parse(JSON.parse(buffer.toString("utf-8")).data);
                        ctx.product = data;
                    } catch (error) {
                        console.error(error);
                        ctx.missingIds?.push(id);
                        throw Error(`Error fetching product ${id} from api`);
                    }
                }
            },
            {
                title: (_, ctx, [id]) => {
                    return `rendering product ${id} - ${ctx["count"]} remaining`;
                },
                async action(params: TaskParams, ctx: TaskContext, [id]: any[]) {
                    if (ctx.product === undefined) {
                        return;
                    }
                    const templatePath = path.resolve(__dirname, "templates/ejs/index.ejs");
                    const templateFile = fs.readFileSync(templatePath, "utf-8");
                    const result = ejs.render(templateFile, {
                        product: ctx.product,
                        ...params
                    }, {
                        views: [path.resolve(__dirname, "templates/ejs")]
                    });
                    ctx.chunk = result;
                }
            },
            {
                title: (_, __, [id]) => {
                    return `save product ${id} to file`;
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
    {
        title: "missing products",
        async action(params: TaskParams, ctx: TaskContext) {
            console.log("[missing products]", ctx.missingIds);
            fs.writeFileSync(path.resolve(__dirname, `../../../data/batch${params.batchNumber}/missing`), ctx.missingIds!.join(EOL));
        }
    },
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
