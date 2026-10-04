"use client";

import { useState } from "react";

type ProductImage = {
  id: string;
  is_primary: boolean;
  imageUrl: string;
};

type ProductImageGalleryProps = {
  images: ProductImage[];
  productName: string;
};

export default function ProductImageGallery({
  images,
  productName,
}: ProductImageGalleryProps) {
  const primaryImage =
    images.find((image) => image.is_primary) ?? images[0] ?? null;

  const [selectedImageId, setSelectedImageId] = useState(
    primaryImage?.id ?? null
  );

  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? primaryImage;

  if (!selectedImage) {
    return (
      <div className="card grid aspect-[4/3] place-items-center text-sm text-zinc-600">
        Şəkil yoxdur
      </div>
    );
  }

  return (
    <div>
      <div className="card flex aspect-[4/3] items-center justify-center overflow-hidden bg-zinc-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={selectedImage.imageUrl}
          alt={productName}
          className="h-full w-full object-contain p-3"
        />
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => {
            const isSelected = image.id === selectedImage.id;

            return (
              <button
                key={image.id}
                type="button"
                onClick={() => setSelectedImageId(image.id)}
                aria-label={`Şəkil ${index + 1}`}
                aria-pressed={isSelected}
                className={`shrink-0 overflow-hidden rounded-lg border-2 bg-zinc-950 p-0.5 ${
                  isSelected
                    ? "border-amber-500"
                    : "border-zinc-800 hover:border-zinc-600"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 object-contain sm:h-20 sm:w-20"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
