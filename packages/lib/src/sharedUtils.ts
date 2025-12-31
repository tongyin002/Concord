export const decodeBase64 = (base64: string): Uint8Array => {
  const byteString = atob(base64);
  const uint8Array = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  return uint8Array;
};

export const encodeBase64 = (uint8Array: Uint8Array): string => {
  const byteString = String.fromCharCode(...uint8Array);
  return btoa(byteString);
};
