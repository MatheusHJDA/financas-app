import { FixedBillsSection } from "./FixedBillsSection";
import "../accounts/ui.css";

// Provisório (R0): reaproveita a seção de contas fixas até a U19.
export default function FixedBillsPage() {
  return (
    <section className="u8-page">
      <h1>Contas fixas</h1>
      <FixedBillsSection />
    </section>
  );
}
