export type ActionResult = {
  ok: boolean;
  message: string;
} | null;

export function ok(message: string): ActionResult {
  return { ok: true, message };
}

export function fail(message: string): ActionResult {
  return { ok: false, message };
}

const dbMessages: Record<string, string> = {
  "Insufficient stock": "Stokda kifayət qədər məhsul yoxdur.",
  "Cart is empty": "Səbət boşdur.",
  "Cart contains unavailable product":
    "Səbətdə artıq satışda olmayan məhsul var. Onu silib yenidən cəhd edin.",
  "Product not found": "Məhsul tapılmadı və ya satışda deyil.",
  "Cart item not found": "Məhsul səbətdə tapılmadı.",
  "Quantity must be greater than zero": "Miqdar ən azı 1 olmalıdır.",
  "Active customer profile required": "Hesabınız aktiv deyil.",
  "Authentication required": "Sessiya bitib. Yenidən daxil olun.",
  "SKU already exists": "Bu SKU artıq mövcuddur.",
  "SKU is required": "SKU tələb olunur.",
  "Category slug already exists": "Bu slug artıq istifadə olunur.",
  "Category not found": "Kateqoriya tapılmadı.",
  "Only pending orders can change status":
    "Yalnız gözləyən sifarişlərin statusu dəyişdirilə bilər.",
  "Order not found": "Sifariş tapılmadı.",
  "Archived customer cannot be activated":
    "Arxivdəki müştəri aktivləşdirilə bilməz.",
  "Customer not found": "Müştəri tapılmadı.",
  "Product name is required": "Məhsul adı tələb olunur.",
  "Only images can be primary": "Yalnız şəkil əsas ola bilər.",
  "MFA required": "İki mərhələli təsdiq tələb olunur. Yenidən daxil olun.",
  "Category hierarchy cannot contain a cycle":
    "Kateqoriyanı öz alt kateqoriyasının altına köçürmək olmaz.",
  "Category cannot be its own parent":
    "Kateqoriya özünün ana kateqoriyası ola bilməz.",
  "Category hierarchy too deep":
    "Kateqoriya ağacı ən çox 10 səviyyəli ola bilər.",
  "Parent category not found": "Ana kateqoriya tapılmadı.",
  "Category name is required": "Kateqoriya adı mütləqdir (maks. 100 simvol).",
  "Category slug is required":
    "Slug yalnız kiçik latın hərfləri, rəqəmlər və tire ola bilər.",
  "Cancelled orders cannot be changed": "Ləğv edilmiş sifariş dəyişdirilə bilməz.",
  "Order is cancelled": "Sifariş ləğv edilib.",
  "Invalid quantity": "Miqdar 1 ilə 100 000 arasında tam ədəd olmalıdır.",
  "Invalid price": "Qiymət 0 və ya daha böyük olmalıdır.",
  "Invalid order items": "Sifariş məhsulları yanlışdır.",
  "Duplicate product": "Eyni məhsul iki dəfə əlavə edilib.",
  "Order must have at least one product":
    "Sifarişdə ən azı bir məhsul qalmalıdır. Hamısını silmək üçün sifarişi ləğv edin.",
  "Only pending orders can be edited":
    "Yalnız gözləyən sifarişlər dəyişdirilə bilər.",
  "Order was changed by someone else":
    "Bu sifarişi başqa əməkdaş indicə dəyişdi. Səhifəni yeniləyib yenidən yoxlayın.",
  "Product is not available": "Bu məhsul satışda deyil, əlavə etmək olmaz.",
  "Normal price is required": "Normal qiymət mütləqdir.",
  "Prices cannot be negative": "Qiymət mənfi ola bilməz.",
  "Price is too high": "Qiymət çox böyükdür.",
  "Sale price must be lower than normal price":
    "Endirimli qiymət normal qiymətdən aşağı olmalıdır.",
  "Stock cannot be negative": "Stok 0 və ya daha böyük tam ədəd olmalıdır.",
};

export function dbErrorMessage(
  error: { message?: string } | null | undefined,
  fallback: string
) {
  const message = error?.message ?? "";

  if (message.startsWith("Insufficient stock for ")) {
    return `Stokda kifayət qədər məhsul yoxdur (${message.slice(23)}).`;
  }

  if (message.startsWith("Not authorized")) {
    return "Bu əməliyyat üçün icazəniz yoxdur.";
  }

  return dbMessages[message] ?? fallback;
}
