import fs from "node:fs";
import path from "node:path";
import { EOL } from "node:os";

import axios from "axios";
import ora from "ora";
import chalk from "chalk";
import { AceBase } from "acebase";

import "dotenv/config";


const batchNumber = 1;

function deepCopy(obj: any) {
    // Declare object which will store the output 
    // If the object isnt of type object or  
    // object is null, undefined
    // or a function then no need to iterate 
    // over it and simply return it 
    if (typeof obj !== "object" ||
        typeof obj === undefined ||
        obj === null ||
        typeof obj == "function") {
        return obj;
    }
    const result = Array.isArray(obj) ? [] : {};

    if (Array.isArray(obj)) {
        if (obj.length === 0)
            return undefined;
        else {
            for (let i = 0; i < obj.length; i++) {
                result[i] = deepCopy(obj[i])
            }
            if (result.length === 1 && result[0] === null || result[0] === undefined)
                return undefined;
            return result;
        };
    }

    // Store the keys of the object 
    const keys = Object.keys(obj);

    // Iterate through the keys of the 
    // object retrieved above 
    for (let key in keys) {

        // Recursively iterate through each of the key. 
        result[keys[key]] = deepCopy(obj[keys[key]])
    }
    return result;
}


async function getProductsPagged(skip = 0, take = 1000, callback?: (products: any[], from: number, to: number) => Promise<void>) {
    const baseUrl = process.env.AZURE_SEARCH_BASE_URL;
    const apiKey = process.env.AZURE_SEARCH_API_KEY;

    const ids = fs.readFileSync(path.resolve(__dirname, `batch${batchNumber}`), "utf-8").split(EOL);

    const response = await axios.post(
        `${baseUrl}/indexes/product-data/docs/search?api-version=2023-11-01`, {
        //search: "\"code\" : \"men_*",
        filter: `salesMarket eq 'IN' and search.in(productId,'${ids.join(",")}',',')`,
        select: "data",
        searchFields: "data",
        searchMode: "all",
        skip,
        top: take,
        count: true
    }, {
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
        },
    });

    if (response.status !== 200) {
        console.error("Failed to fetch data from Azure Search", response.data, response.statusText);
    }

    //console.log("Full Product count", response.data["@odata.count"]);

    const returnValue = response.data.value.map(rawData => deepCopy(JSON.parse(rawData.data)));

    if (callback) {
        await callback(returnValue, skip, skip + take);
    }

    if (response.data["@odata.count"] <= skip || skip > 5000) {
        return;
    }

    await getProductsPagged(skip + take, take, callback);
}

async function initDatabase() {
    const db = new AceBase("productsDb", {
        storage: {
            path: `../../data/batch${batchNumber}`,
            removeVoidProperties: true
        },
        logLevel: "error"
    });
    await db.ready();
    return db;
}


async function exportProducts(db: AceBase) {
    await db.ref("products")
        .query()
        .filter("productId", "in", ["1188777"])
        .forEach(p => {
            fs.writeFileSync(`./exports/${p.val().productId}.json`, JSON.stringify(p.val(), null, 2), { flag: 'a' });
        });

    //await db.ref(`products/0569984`).export(write)
    //stream.close();
}

async function main() {
    const db = await initDatabase();
    const startIndex = 150;
    const pageSize = 150;

    await getProductsPagged(startIndex, pageSize, async (products, from, to) => {
        const spinner = ora({
            discardStdin: false,
            spinner: "arc",
        });

        spinner.start(`Fetched products from ${from} to ${to}`);
        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            await db.ref(`products/${product.productId}`).set(product);
            spinner.text = chalk.green(`Saved product ${product.productId}`);
        }
        spinner.succeed(`Saved products from ${from} to ${to}`);
    });

    //await exportProducts(db);
}

await main();