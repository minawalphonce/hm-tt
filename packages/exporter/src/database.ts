import { AceBase } from "acebase";

export async function initDatabase(batchNumber: number) {
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