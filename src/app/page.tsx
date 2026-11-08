import { redirect } from "next/navigation";

import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/ui";
import { getSession } from "@/lib/auth";

import { logout } from "./(shop)/account/actions";

export default async function Home() {
  const { user, mfaVerified, staff, customer, account } = await getSession();

  if (!user) {
    redirect("/login");
  }

  if (!mfaVerified) {
    redirect("/mfa");
  }

  if (account && !account.session_current) {
    redirect("/login?error=session");
  }

  if (account?.must_change_password) {
    redirect("/change-password");
  }

  if (staff?.active) {
    redirect("/admin");
  }

  if (customer?.active && !customer.archived_at) {
    redirect("/products");
  }

  if (customer) {
    redirect("/login?error=inactive");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>

        <h1 className="mt-6 text-xl font-semibold text-white">
          Giriş icazəsi yoxdur
        </h1>

        <p className="mt-2 text-sm text-zinc-400">
          Hesabınıza bu panel üçün icazə verilməyib. Administratorla
          əlaqə saxlayın.
        </p>

        <form action={logout} className="mt-6">
          <SubmitButton className="btn btn-secondary w-full">
            Çıxış
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
