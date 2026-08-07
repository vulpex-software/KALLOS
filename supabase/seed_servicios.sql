-- =========================================================
-- Catálogo de servicios - Yessica Arango Nail & Beauty Experts
-- Ejecutar después de schema.sql, en: Supabase Dashboard > SQL Editor
-- Se puede volver a correr cuando cambien los precios: actualiza
-- el precio de los que ya existen (por categoria + nombre) y no
-- duplica filas.
-- =========================================================

insert into public.servicios (categoria, nombre, precio_base) values
  -- MANICURE
  ('Manicure', 'Manicure Tradicional', 20000),
  ('Manicure', 'Manicure Semipermanente', 50000),
  ('Manicure', 'Base Rubber Luxe', 85000),
  ('Manicure', 'Dipping + Semipermanente', 85000),

  -- SISTEMAS / EXTENSIONES
  ('Sistemas / Extensiones', 'Acrílicas', 120000),
  ('Sistemas / Extensiones', 'Polygel', 120000),
  ('Sistemas / Extensiones', 'Softgel Clasic', 100000),
  ('Sistemas / Extensiones', 'Softgel Efecto Acrílico', 115000),
  ('Sistemas / Extensiones', 'Recubrimiento de Polygel', 90000),
  ('Sistemas / Extensiones', 'Recubrimiento de Acrílico', 90000),

  -- MANTENIMIENTOS
  ('Mantenimientos', 'Mantenimiento Acrílico', 90000),
  ('Mantenimientos', 'Mantenimiento Polygel', 90000),
  ('Mantenimientos', 'Mantenimiento Softgel', 80000),

  -- RETIROS Y REPARACIONES
  ('Retiros y Reparaciones', 'Reparación de Uña', 10000),
  ('Retiros y Reparaciones', 'Retiro Semipermanente', 15000),
  ('Retiros y Reparaciones', 'Retiro de otros Sistemas', 20000),

  -- PEDICURA
  ('Pedicura', 'Pedicura Tradicional', 28000),
  ('Pedicura', 'Pedicura Semipermanente', 50000),
  ('Pedicura', 'PediSpa', 85000),

  -- ADICIONAL (precio y concepto libres, se completan al registrar el trabajo)
  ('Adicional', 'Adicional (monto y concepto libre)', 0),

  -- PESTAÑAS
  ('Pestañas', 'Lifting', 80000),
  ('Pestañas', 'Natural', 90000),
  ('Pestañas', 'Rímel', 90000),
  ('Pestañas', 'Griego 2D', 110000),
  ('Pestañas', 'Brasileño 3D', 115000),
  ('Pestañas', '4D', 120000),
  ('Pestañas', '5D', 130000),

  -- RETOQUE DE PESTAÑAS
  ('Retoque de Pestañas', 'Natural', 60000),
  ('Retoque de Pestañas', 'Rímel', 60000),
  ('Retoque de Pestañas', 'Griego 2D', 70000),
  ('Retoque de Pestañas', 'Brasileño 3D', 70000),
  ('Retoque de Pestañas', '4D', 75000),
  ('Retoque de Pestañas', '5D', 80000),

  -- DEPILACIÓN
  ('Depilación', 'Cejas Hilo', 25000),
  ('Depilación', 'Cejas Cera', 12000),
  ('Depilación', 'Bozo Hilo', 18000),
  ('Depilación', 'Bozo Cera', 8000),
  ('Depilación', 'Axila', 20000),

  -- CEJAS
  ('Cejas', 'Depilación + Pigmentación', 35000),
  ('Cejas', 'Mapa Cejas', 15000),
  ('Cejas', 'Laminado', 80000)

on conflict (categoria, nombre)
do update set precio_base = excluded.precio_base, activo = true;
