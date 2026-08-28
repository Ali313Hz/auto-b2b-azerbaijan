"use client";

import { permanentlyDeleteCustomer } from "./actions";

type DeleteCustomerButtonProps = {
  customerId: string;
  companyName: string | null;
};

export default function DeleteCustomerButton({
  customerId,
  companyName,
}: DeleteCustomerButtonProps) {
  return (
    <form
      action={permanentlyDeleteCustomer}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `${companyName ?? "Bu müşteri"} kalıcı olarak silinsin mi?\n\nBu işlem geri alınamaz.`
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input
        type="hidden"
        name="customerId"
        value={customerId}
      />

      <button
        type="submit"
        className="rounded-lg border border-red-800 px-4 py-2 text-red-400"
      >
        Kalıcı Olarak Sil
      </button>
    </form>
  );
}