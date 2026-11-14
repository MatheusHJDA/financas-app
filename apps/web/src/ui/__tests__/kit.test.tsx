import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChipGroup,
  Chip,
  HideValuesProvider,
  Money,
  MonthSwitcher,
  Sheet,
  SkeletonGroup,
  Skeleton,
  SparkleIcon,
  StatCard,
  Card,
  Button,
  IconButton,
  useHideValues,
} from "../index";
import { Wallet } from "lucide-react";

function Toggle() {
  const { hidden, toggle } = useHideValues();
  return (
    <button type="button" onClick={toggle}>
      {hidden ? "Mostrar valores" : "Ocultar valores"}
    </button>
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Money", () => {
  it("formata e respeita o olho", () => {
    render(
      <HideValuesProvider>
        <Money cents={123456789} />
        <Toggle />
      </HideValuesProvider>,
    );
    expect(screen.getByText("R$ 1.234.567,89")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar valores" }));
    expect(screen.getByLabelText("Valor oculto")).toBeTruthy();
    expect(screen.queryByText("R$ 1.234.567,89")).toBeNull();
  });

  it("negativo com sinal", () => {
    render(<Money cents={-5000} signed />);
    expect(screen.getByText("−R$ 50,00")).toBeTruthy();
  });

  it("positivo com sinal e tom de receita", () => {
    render(<Money cents={5000} signed />);
    const el = screen.getByText("+R$ 50,00");
    expect(el.className).toContain("money--income");
  });

  it("sem provider mostra o valor", () => {
    render(<Money cents={100} />);
    expect(screen.getByText("R$ 1,00")).toBeTruthy();
  });
});

describe("useHideValues", () => {
  it("sobrevive a localStorage que lança", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(
      <HideValuesProvider>
        <Money cents={100} />
        <Toggle />
      </HideValuesProvider>,
    );
    expect(screen.getByText("R$ 1,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar valores" }));
    expect(screen.getByLabelText("Valor oculto")).toBeTruthy();
  });

  it("persiste no aparelho", () => {
    const first = render(
      <HideValuesProvider>
        <Toggle />
      </HideValuesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ocultar valores" }));
    expect(localStorage.getItem("finance.hideValues")).toBe("1");
    first.unmount();
    render(
      <HideValuesProvider>
        <Money cents={100} />
      </HideValuesProvider>,
    );
    expect(screen.getByLabelText("Valor oculto")).toBeTruthy();
  });
});

describe("MonthSwitcher", () => {
  function Harness({ start, max }: { start: string; max?: string }) {
    const [m, setM] = useState(start);
    return <MonthSwitcher month={m} onChange={setM} max={max} />;
  }

  it("vai e volta de mês, atravessando o ano", () => {
    render(<Harness start="2026-12" />);
    expect(screen.getByText("dezembro de 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(screen.getByText("janeiro de 2027")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(screen.getByText("novembro de 2026")).toBeTruthy();
  });

  it("max desabilita o próximo", () => {
    render(<Harness start="2026-12" max="2026-12" />);
    expect((screen.getByRole("button", { name: "Próximo mês" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Sheet", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={ref} type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
        <Sheet open={open} title="Editar" onClose={() => setOpen(false)}>
          <p>conteúdo</p>
        </Sheet>
      </>
    );
  }

  it("abre com título, fecha com Esc e devolve o foco", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Editar" });
    expect(dialog).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("fecha pelo botão Fechar", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Chip e ChipGroup", () => {
  it("expõe aria-pressed e o grupo", () => {
    const onClick = vi.fn();
    render(
      <ChipGroup label="Período">
        <Chip selected onClick={onClick}>
          Esse mês
        </Chip>
        <Chip selected={false} onClick={onClick}>
          Mês passado
        </Chip>
      </ChipGroup>,
    );
    expect(screen.getByRole("group", { name: "Período" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esse mês" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Skeleton", () => {
  it("SkeletonGroup anuncia carregando", () => {
    render(
      <SkeletonGroup label="Carregando saldos">
        <Skeleton variant="line" />
      </SkeletonGroup>,
    );
    const status = screen.getByRole("status", { name: "Carregando saldos" });
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});

describe("SparkleIcon", () => {
  it("dois na mesma tela não repetem o id do degradê", () => {
    const { container } = render(
      <>
        <SparkleIcon />
        <SparkleIcon />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });
});

describe("Card, StatCard, Button, IconButton", () => {
  it("Card com título vira região nomeada", () => {
    render(
      <Card title="Contas" icon={Wallet}>
        <p>x</p>
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Contas" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Contas" })).toBeTruthy();
  });

  it("StatCard é um grupo com rótulo e valor", () => {
    render(<StatCard label="Receitas" icon={Wallet} tone="income" cents={87700} />);
    const group = screen.getByRole("group", { name: "Receitas" });
    expect(group.textContent).toContain("R$ 877,00");
  });

  it("IconButton usa o rótulo como nome", () => {
    render(<IconButton icon={Wallet} label="Avisos" />);
    expect(screen.getByRole("button", { name: "Avisos" })).toBeTruthy();
  });

  it("Button primário tem a classe da variante", () => {
    render(<Button variant="primary">Salvar</Button>);
    expect(screen.getByRole("button", { name: "Salvar" }).className).toContain("ui-btn--primary");
  });
});
