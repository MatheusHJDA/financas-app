import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Clock, Eye, EyeOff, Landmark, Plus, Wallet } from "lucide-react";
import { useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChipGroup,
  IconButton,
  ListItem,
  Money,
  MonthSwitcher,
  Sheet,
  Skeleton,
  SkeletonGroup,
  SparkleIcon,
  StatCard,
  useHideValues,
} from "../ui";

// Catálogo do kit, só em desenvolvimento (/dev/kit). Serve para conferir as peças nos dois temas.
export default function KitPage() {
  const [month, setMonth] = useState("2026-12");
  const [chip, setChip] = useState("mes");
  const [open, setOpen] = useState(false);
  const { hidden, toggle } = useHideValues();

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Kit visual</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" icon={Plus}>
          Primário
        </Button>
        <Button>Secundário</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="danger">Perigo</Button>
        <IconButton icon={hidden ? Eye : EyeOff} label={hidden ? "Mostrar valores" : "Ocultar valores"} onClick={toggle} />
        <SparkleIcon size={32} title="IA" />
      </div>
      <MonthSwitcher month={month} onChange={setMonth} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <StatCard label="Receitas" icon={ArrowUpCircle} tone="income" cents={840000} />
        <StatCard label="Despesas" icon={ArrowDownCircle} tone="expense" cents={512000} />
        <StatCard label="Contas pagas" icon={CheckCircle2} tone="info" value="9 de 14" hint={<Money cents={320000} />} />
        <StatCard label="A pagar" icon={Clock} tone="warning" cents={183000} hint="5 contas" />
      </div>
      <Card title="Minhas contas" icon={Wallet} action={<IconButton icon={Plus} label="Nova conta" />}>
        <ListItem leading={<Avatar name="Nubank" tone="info" />} title="Nubank" subtitle="Conta corrente" trailing={<Money cents={357634} />} />
        <ListItem leading={<Avatar name="Carteira" tone="income" />} title="Carteira" subtitle="Dinheiro" trailing={<Money cents={-4000} signed />} />
        <ListItem leading={<Avatar name="Inter" tone="warning" />} title="Inter" subtitle="Abrir" onClick={() => setOpen(true)} trailing={<Landmark size={18} aria-hidden="true" />} />
      </Card>
      <ChipGroup label="Período">
        <Chip selected={chip === "mes"} onClick={() => setChip("mes")}>
          Esse mês
        </Chip>
        <Chip selected={chip === "passado"} onClick={() => setChip("passado")}>
          Mês passado
        </Chip>
      </ChipGroup>
      <Card title="Carregando">
        <SkeletonGroup label="Carregando exemplo">
          <Skeleton width="40%" />
          <Skeleton variant="block" />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Skeleton variant="circle" />
            <Skeleton />
          </div>
        </SkeletonGroup>
      </Card>
      <Sheet open={open} title="Editar conta" onClose={() => setOpen(false)}>
        <p>Conteúdo do painel.</p>
        <Button variant="primary" block onClick={() => setOpen(false)}>
          Salvar
        </Button>
      </Sheet>
    </section>
  );
}
