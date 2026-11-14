import { TransactionsSection } from "../overview/TransactionsSection";
import "../accounts/ui.css";

// Provisório (R0): reaproveita a seção de movimentações até a U17.
export default function TransactionsPage() {
  return (
    <section className="u8-page">
      <h1>Transações</h1>
      <TransactionsSection />
    </section>
  );
}
