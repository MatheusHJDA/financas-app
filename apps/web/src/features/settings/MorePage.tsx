import { ChevronRight, LogOut } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { MORE_ITEMS } from "../../shell/nav";
import { Avatar, Button, Card, Skeleton, SkeletonGroup } from "../../ui";
import "./settings.css";

// Tela Mais (celular): atalhos com ícone para o que não cabe na barra, quem está conectado e Sair.
export default function MorePage() {
  const { me, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const isAdmin = me?.role === "admin";

  return (
    <section className="screen">
      <h1>Mais</h1>
      {me === undefined ? (
        <SkeletonGroup label="Carregando">
          <div className="more-who">
            <Skeleton variant="circle" width="44px" height="44px" />
            <Skeleton width="55%" />
          </div>
          <Skeleton variant="block" height="280px" />
        </SkeletonGroup>
      ) : (
        <>
          {me ? (
            <div className="more-who">
              <Avatar name={me.name} tone="income" />
              <p className="more-who__text">Conectado como {me.name}</p>
            </div>
          ) : null}
          <Card>
            <ul className="more-list">
              {MORE_ITEMS.filter((i) => !i.adminOnly || isAdmin).map((i) => (
                <li key={i.to}>
                  <Link to={i.to} className="more-link">
                    <span className="more-link__icon" aria-hidden="true">
                      <i.icon size={20} strokeWidth={1.75} />
                    </span>
                    <span className="more-link__label">{i.label}</span>
                    <ChevronRight aria-hidden="true" size={18} className="more-link__chev" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Button
            variant="danger"
            icon={LogOut}
            block
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              void logout().finally(() => setLeaving(false));
            }}
          >
            Sair
          </Button>
        </>
      )}
    </section>
  );
}
