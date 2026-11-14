import { NavLink } from "react-router-dom";
import { SparkleIcon } from "../ui";
import { MOBILE_TABS } from "./nav";

/** Barra flutuante em pílula (celular), com a ✦ central para lançar com IA. */
export function BottomBar() {
  return (
    <nav className="bottombar" aria-label="Principal">
      {MOBILE_TABS.map((t) =>
        t.sparkle ? (
          <NavLink key={t.to} to={t.to} className="bottombar__sparkle" aria-label={t.label}>
            <SparkleIcon size={30} />
          </NavLink>
        ) : (
          <NavLink key={t.to} to={t.to} end={t.end} className="bottombar__tab">
            <t.icon aria-hidden="true" size={22} strokeWidth={1.75} />
            <span>{t.label}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}
