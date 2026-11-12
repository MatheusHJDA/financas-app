import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";

interface Health {
  status: string;
  version: string;
}

async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as Health;
}

function Home() {
  const { data, isPending, isError } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const label = isPending ? "carregando…" : isError ? "erro" : data.status;
  return (
    <main style={{ padding: "var(--space-3)" }}>
      <h1>Finanças</h1>
      <p>
        API: <strong>{label}</strong>
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
