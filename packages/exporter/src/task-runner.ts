import chalk from "chalk";
import ora, { Ora } from "ora";

export type Task<TTaskParams = Record<string, string>, TTaskContext = Record<string, any>> = {
    title: TaskTitle;
    skip?: (params: TTaskParams) => boolean;
    action: ((params: TTaskParams, ctx: TTaskContext, executeSubTasks?: () => Promise<void>) => Promise<void>) | ((params: TTaskParams, ctx: TTaskContext, args: any) => Promise<void>)
    children?: Task<TTaskParams, TTaskContext>[];
}

export type TaskTitle = string | (<TTaskParams = Record<string, string>, TTaskContext = Record<string, any>>(params: TTaskParams, context: TTaskContext, args?: any) => string);

function renderTitle<TTaskParams = Record<string, string>, TTaskContext = Record<string, any>>(txt: string | ((params: TTaskParams, context: TTaskContext, args?: any) => string)) {
    return (params: TTaskParams, context: TTaskContext, args?: any) => {
        if (typeof txt === "string") {
            return txt;
        }
        return txt(params, context, args);
    }
}

async function executeTask<TTaskParams = Record<string, string>, TTaskContext = Record<string, any>>(spinner: Ora, task: Task<TTaskParams, TTaskContext>, params: TTaskParams, context: TTaskContext, args?: any[]) {
    spinner.start(renderTitle(task.title)(params, context, args));
    try {
        if (task.skip && task.skip(params)) {
            spinner.suffixText = chalk.bold.blue(" Skipped ");
            spinner.clear();
        }
        else {
            let subtaskResolver: ((...args: any) => Promise<void>) | undefined = undefined;
            if (task.children && task.children.length > 0) {
                subtaskResolver = async (...args) => {
                    const subSpinner = ora({
                        discardStdin: false,
                        spinner: "dots",
                        indent: 2
                    });
                    //@ts-expect-error
                    for (const subtask of task.children) {
                        await executeTask<TTaskParams, TTaskContext>(subSpinner, subtask, params, context, args);
                    }
                    //new line after subtask
                    subSpinner.stopAndPersist({
                        text: "",
                        suffixText: "",
                        prefixText: ""
                    })
                }
            }

            await task.action(params, context, subtaskResolver || args);
            spinner.suffixText = chalk.bold.green(" Done ");
            spinner.succeed();
        }
    } catch (err) {
        spinner.suffixText = "";
        spinner.fail(chalk.red(err));
    }
    spinner.stop();
}

export async function runTasks<TTaskParams = Record<string, string>, TTaskContext extends Record<string, any> = Record<string, any>>(params: TTaskParams, tasks: Task<TTaskParams>[]) {
    const spinner = ora({
        discardStdin: false,
        spinner: "dots",
    });
    const context: any = {};
    for (const task of tasks) {
        await executeTask<TTaskParams, TTaskContext>(spinner, task, params, context);
    }
}