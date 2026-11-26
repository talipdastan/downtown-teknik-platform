/**
 * Samsung (HEIC/HEIF, 50MP/108MP) ve yüksek çözünürlüklü telefon/bilgisayar
 * fotoğraflarını Supabase Storage'a yüklemeden önce tarayıcı içinde <canvas>
 * ile maksimum 1200px çözünürlüğe ve WebP/JPEG (%72 kalite -> ~80-140 KB)
 * boyutuna sıkıştırır. Böylece veritabanı ve depolama alanı gereksiz şişmez.
 */
export async function compressImageForUpload(
  file: File,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<File> {
  const maxDim = options.maxDimension ?? 1200;
  const quality = options.quality ?? 0.72;

  if (typeof window === 'undefined' || file.type === 'application/pdf') {
    return file;
  }

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width <= 0 || height <= 0) {
        resolve(file);
        return;
      }

      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // WebP destekleniyorsa WebP (%35 daha küçük), desteklenmiyorsa JPEG üret
      const targetMime = 'image/webp';
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          // Eğer sıkıştırılmış hali orijinalden büyükse orijinali koru
          if (blob.size >= file.size && file.size < 250 * 1024) {
            resolve(file);
            return;
          }
          const baseName = (file.name || 'foto')
            .replace(/\.[^/.]+$/, '')
            .replace(/[^a-zA-Z0-9._-]/g, '_');
          const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
          const compressedFile = new File([blob], `${baseName}.${ext}`, {
            type: blob.type || 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        targetMime,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}
