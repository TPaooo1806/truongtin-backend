export const triggerRevalidate = async (path: string) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const secret = process.env.REVALIDATE_SECRET || 'truongtin_secret_2024';
    
    await fetch(`${frontendUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ secret, path })
    });
    console.log(`[Revalidate] Successfully triggered revalidate for ${path}`);
  } catch (error: any) {
    console.error(`[Revalidate Error] Failed to revalidate ${path}:`, error.message);
  }
};
