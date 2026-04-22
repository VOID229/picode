import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MessageImageAttachment } from "../../domains/types";
import { messageImageSrc } from "../../lib/messageImages";

type GalleryImage = MessageImageAttachment & { id?: string };

interface ImageAttachmentGalleryProps {
  images: GalleryImage[];
  align?: "start" | "end";
  onRemove?: (image: GalleryImage, index: number) => void;
}

export function ImageAttachmentGallery({
  images,
  align = "start",
  onRemove,
}: ImageAttachmentGalleryProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewImage =
    previewIndex !== null && previewIndex < images.length
      ? images[previewIndex]
      : null;

  useEffect(() => {
    if (previewIndex !== null && previewIndex >= images.length) {
      setPreviewIndex(null);
    }
  }, [images.length, previewIndex]);

  useEffect(() => {
    if (previewIndex === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewIndex]);

  const imageSources = useMemo(
    () => images.map((image) => messageImageSrc(image)),
    [images],
  );

  if (images.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={`message-image-gallery message-image-gallery--${align}`}
        role="list"
      >
        {images.map((image, index) => (
          <div
            key={image.id ?? `${index}-${image.data.slice(0, 16)}`}
            className="message-image-thumbnail"
          >
            <button
              type="button"
              className="message-image-thumbnail__button"
              onClick={() => setPreviewIndex(index)}
            >
              <img src={imageSources[index]} alt="Pasted screenshot" />
            </button>
            {onRemove && (
              <button
                type="button"
                className="message-image-remove"
                aria-label="Remove image"
                title="Remove image"
                onClick={() => onRemove(image, index)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {previewImage && previewIndex !== null && (
        <div
          className="message-image-preview"
          onClick={() => setPreviewIndex(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="message-image-preview__frame"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="message-image-preview__close"
              aria-label="Close preview"
              title="Close preview"
              onClick={() => setPreviewIndex(null)}
            >
              <X size={16} />
            </button>
            <img
              className="message-image-preview__image"
              src={imageSources[previewIndex]}
              alt="Pasted screenshot preview"
            />
          </div>
        </div>
      )}
    </>
  );
}
