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
};

export function dbErrorMessage(
  error: { message?: string } | null | undefined,
  fallback: string
) {
  const message = error?.message ?? "";

  if (message.startsWith("Not authorized")) {
    return "Bu əməliyyat üçün icazəniz yoxdur.";
  }

  return dbMessages[message] ?? fallback;
}
