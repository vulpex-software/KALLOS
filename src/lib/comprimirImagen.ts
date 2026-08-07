// Comprime una imagen en el navegador antes de subirla:
// la reduce a un lado máximo y la reencoda en JPEG de calidad media.
// Una foto de ~3 MB queda en ~100-200 KB, sin perder claridad para evidencia.
export async function comprimirImagen(file: File, maxLado = 1000, calidad = 0.7): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = rej
      r.readAsDataURL(file)
    })
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = dataUrl
    })
    const escala = Math.min(1, maxLado / Math.max(img.width, img.height))
    const w = Math.round(img.width * escala)
    const h = Math.round(img.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad))
    if (!blob) return file
    const nombre = file.name.replace(/\.\w+$/, '') + '.jpg'
    return new File([blob], nombre, { type: 'image/jpeg' })
  } catch {
    return file // si algo falla, sube la original
  }
}
