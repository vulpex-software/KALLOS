-- Marca y proveedor del producto de vitrina, para sugerirlos como
-- autocompletar en "Pago a proveedores" del Cierre de Caja.
alter table public.productos add column marca text;
alter table public.productos add column proveedor text;
