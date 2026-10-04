"use client";

import { useState } from "react";

type ProductImage = {
  id: string;
  is_primary: boolean;
  imageUrl: string | null;
};

type ProductImageGalleryProps = {
  images: ProductImage[];
  productName: string;
};

export default function ProductImageGallery({
  images,
  productName,
}: ProductImageGalleryProps) {
  const availableImages = images.filter(
    (image) => image.imageUrl
  );

  const primaryImage =
    availableImages.find(
      (image) => image.is_primary
    ) ??
    availableImages[0] ??
    null;

  const [selectedImageId, setSelectedImageId] =
    useState(primaryImage?.id ?? null);

  const selectedImage =
    availableImages.find(
      (image) => image.id === selectedImageId
    ) ??
    primaryImage;

  if (!selectedImage?.imageUrl) {
    return null;
  }

  return (
    <div>
      <div className="flex min-h-96 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={selectedImage.imageUrl}
          alt={productName}
          className="max-h-96 max-w-full rounded-lg object-contain"
        />
      </div>

      {availableImages.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {availableImages.map((image) => {
            if (!image.imageUrl) {
              return null;
            }

            const isSelected =
              image.id === selectedImage.id;

            return (
              <button
                key={image.id}
                type="button"
                onClick={() =>
                  setSelectedImageId(image.id)
                }
                className={
                  isSelected
                    ? "rounded-lg border-2 border-green-600 p-1"
                    : "rounded-lg border border-zinc-700 p-1"
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.imageUrl}
                  alt={productName}
                  className="h-24 w-24 rounded object-contain"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}