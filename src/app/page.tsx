import { redirect } from "next/navigation";

import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/ui";
import { getSession } from "@/lib/auth";

import { logout } from "./(shop)/account/actions";

export default async function Home() {
  const { user, staff, customer } = await getSession();

  if (!user) {
    redirect("/login");
  }

  if (staff?.active && staff.role === "OWNER") {
    redirect("/admin");
  }

  if (customer?.active) {
    redirect("/products");
  }

  if (customer && !customer.active) {
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
