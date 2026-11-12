import { EmptyState } from "../ui/States";

export function Placeholder({ title }: { title: string }) {
  return (
    <section className="screen">
      <h1>{title}</h1>
      <EmptyState title="Em construção" hint="Esta tela chega nas próximas etapas." />
    </section>
  );
}
