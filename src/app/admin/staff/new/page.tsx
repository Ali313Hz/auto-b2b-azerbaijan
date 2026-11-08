import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";

import StaffCreateForm from "./StaffCreateForm";

export const metadata: Metadata = {
  title: "Yeni işçi",
};

export default async function NewStaffPage() {
  await requireOwner();

  return (
    <>
      <Link
        href="/admin/staff"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← İşçilər
      </Link>

      <PageHeader
        title="Yeni işçi"
        description="İşçi müvəqqəti şifrə ilə daxil olub öz şifrəsini təyin edəcək."
      />

      <StaffCreateForm />
    </>
  );
}
