-- Borrar un permiso/descanso mal registrado. Editar ya funcionaba (la
-- policy de update existente no restringe columnas), esto solo agrega
-- delete para la dueña.
drop policy if exists "super borra permisos de su salon" on public.permisos;
create policy "super borra permisos de su salon"
  on public.permisos for delete
  using (public.es_super() and salon_id = public.mi_salon());
