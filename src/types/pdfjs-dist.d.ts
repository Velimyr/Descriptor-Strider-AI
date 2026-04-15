declare module 'pdfjs-dist' {
  export interface RenderTask {
    promise: Promise<void>;
  }

  export interface PageViewport {
    width: number;
    height: number;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): PageViewport;
    render(params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: PageViewport;
    }): RenderTask;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
    destroy(): void;
  }

  export const version: string;

  export const GlobalWorkerOptions: {
    workerSrc: string;
  };

  export function getDocument(src: {
    data: ArrayBuffer | Uint8Array;
  }): PDFDocumentLoadingTask;
}
