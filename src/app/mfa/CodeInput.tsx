type CodeInputProps = {
  id: string;
  disabled?: boolean;
};

// Six-digit TOTP field; works with password managers and SMS-style autofill.
export default function CodeInput({ id, disabled }: CodeInputProps) {
  return (
    <input
      id={id}
      name="code"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      minLength={6}
      required
      disabled={disabled}
      placeholder="000000"
      className="input text-center font-mono text-2xl tracking-[0.5em]"
    />
  );
}

export function readCode(form: HTMLFormElement) {
  const code = String(new FormData(form).get("code") ?? "").replace(/\s/g, "");

  return /^\d{6}$/.test(code) ? code : null;
}

export const codeErrors = {
  format: "6 rəqəmli kodu daxil edin.",
  invalid: "Kod yanlışdır və ya vaxtı keçib. Tətbiqdəki yeni kodu daxil edin.",
  rateLimited: "Çox sayda cəhd edildi. Bir neçə dəqiqə sonra yenidən cəhd edin.",
};
