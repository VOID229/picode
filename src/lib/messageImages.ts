import type {
  ComposerImageDraft,
  MessageImageAttachment,
} from "../domains/types";

export function messageImageSrc(image: MessageImageAttachment) {
  return `data:${image.mimeType};base64,${image.data}`;
}

export async function fileToComposerImageDraft(
  file: File,
): Promise<ComposerImageDraft> {
  const dataUrl = await blobToDataUrl(file);
  return dataUrlToComposerImageDraft(dataUrl, file.type || "image/png");
}

export async function rgbaClipboardImageToComposerImageDraft(params: {
  rgba: Uint8Array;
  width: number;
  height: number;
}): Promise<ComposerImageDraft> {
  const canvas = document.createElement("canvas");
  canvas.width = params.width;
  canvas.height = params.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to access the canvas context for pasted image data.");
  }

  const imageData = new ImageData(
    new Uint8ClampedArray(params.rgba),
    params.width,
    params.height,
  );
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }
      reject(new Error("Unable to encode the pasted image."));
    }, "image/png");
  });

  const dataUrl = await blobToDataUrl(blob);
  return dataUrlToComposerImageDraft(dataUrl, "image/png");
}

function dataUrlToComposerImageDraft(
  dataUrl: string,
  fallbackMimeType: string,
): ComposerImageDraft {
  const [prefix, data = ""] = dataUrl.split(",", 2);
  const mimeType =
    prefix.match(/^data:(.*?);base64$/)?.[1] || fallbackMimeType || "image/png";

  return {
    id: crypto.randomUUID(),
    mimeType,
    data,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error || new Error("Unable to read the pasted image."));
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Unable to decode the pasted image."));
    };
    reader.readAsDataURL(blob);
  });
}
