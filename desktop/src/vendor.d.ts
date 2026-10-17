declare module "mammoth/mammoth.browser" {
  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
      value: string;
      messages: { type: string; message: string }[];
    }>;
  };
  export default mammoth;
}
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist/types/src/pdf";
}
