// Password rules shared by the browser forms and the server actions. The
// same rule is configured in Supabase Auth (Password Requirements), which
// checks it again and stores only the bcrypt hash.

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_RULE_TEXT =
  "Ən azı 12 simvol: böyük və kiçik hərf, rəqəm və simvol.";

export function passwordProblem(password: string): string | null {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    new TextEncoder().encode(password).length > 72
  ) {
    return "Şifrə 12–72 simvol olmalıdır.";
  }

  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "Şifrədə böyük və kiçik hərf, rəqəm və simvol olmalıdır.";
  }

  return null;
}

// Look-alike characters (0/O, 1/l/I) are left out so a password read from
// the screen can be typed without mistakes.
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

// Unbiased random index from the Web Crypto CSPRNG (rejection sampling).
function randomIndex(max: number) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);

  for (;;) {
    crypto.getRandomValues(buffer);

    if (buffer[0] < limit) {
      return buffer[0] % max;
    }
  }
}

// 16 characters, at least one of each class, shuffled.
export function generateTemporaryPassword(length = 16): string {
  const chars = [LOWER, UPPER, DIGITS, SYMBOLS].map(
    (set) => set[randomIndex(set.length)]
  );

  while (chars.length < length) {
    chars.push(ALL[randomIndex(ALL.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
