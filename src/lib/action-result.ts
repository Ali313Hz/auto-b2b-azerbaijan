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
    "Kateqoriya ağacı ən çox 3 səviyyəli ola bilər.",
  "Parent category not found": "Ana kateqoriya tapılmadı.",
  "Category name is required": "Kateqoriya adı mütləqdir (maks. 100 simvol).",
  "Category slug is required":
    "Slug yalnız kiçik latın hərfləri, rəqəmlər və tire ola bilər.",
  "Cancelled orders cannot be changed": "Ləğv edilmiş sifariş dəyişdirilə bilməz.",
  "Revision not found": "Dəyişiklik tapılmadı.",
  "Only drafts can be edited":
    "Bu dəyişiklik artıq müştəriyə göndərilib. Yeni dəyişiklik yaradın.",
  "Only drafts can be sent": "Bu dəyişiklik artıq göndərilib.",
  "Only revisions awaiting the customer can be re-sent":
    "Yalnız müştəri cavabını gözləyən dəyişiklik yenidən göndərilə bilər.",
  "Revision has no items": "Sifarişdə ən azı bir məhsul olmalıdır.",
  "Revision is no longer open":
    "Bu dəyişiklik artıq bağlanıb. Səhifəni yeniləyin.",
  "Order is cancelled": "Sifariş ləğv edilib.",
  "Invalid quantity": "Miqdar 1 ilə 100 000 arasında tam ədəd olmalıdır.",
  "Invalid price": "Qiymət 0 və ya daha böyük olmalıdır.",
  "Invalid order items": "Sifariş məhsulları yanlışdır.",
  "Duplicate product": "Eyni məhsul iki dəfə əlavə edilib.",
  "Note is too long": "Qeyd ən çox 2000 simvol ola bilər.",
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
