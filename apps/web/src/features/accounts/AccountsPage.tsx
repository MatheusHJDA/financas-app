import { AccountsSection } from "./AccountsSection";
import "./ui.css";

// Provisório (R0): reaproveita a seção de contas até a U19.
export default function AccountsPage() {
  return (
    <section className="u8-page">
      <h1>Contas</h1>
      <AccountsSection />
    </section>
  );
}
