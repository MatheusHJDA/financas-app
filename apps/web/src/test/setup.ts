import { configure } from "@testing-library/react";

// Telas lazy + 360+ testes em paralelo: o padrão de 1s do findBy estoura sob carga (falhas intermitentes na R2).
configure({ asyncUtilTimeout: 5000 });
