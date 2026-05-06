declare module "textract" {
  const textract: {
    fromBufferWithMime(mime: string, buffer: Buffer, callback: (error: Error | null, text: string) => void): void;
  };
  export default textract;
}
