import fs from "fs";
import { PDFParse } from "pdf-parse";

async function extract() {
    const dataBuffer = fs.readFileSync("./data/policies/FAQ List.pdf");
    const uint8 = new Uint8Array(dataBuffer);
    const pdfParser = new PDFParse(uint8);
    const text = await pdfParser.getText();
    console.log("--- FAQ TEXT START ---");
    console.log(text);
    console.log("--- FAQ TEXT END ---");
}

extract().catch(console.error);
