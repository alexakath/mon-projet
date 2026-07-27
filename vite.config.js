import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const dolibarrTarget = env.DOLIBARR_TARGET || 'http://dolibarr.localhost/api/index.php'

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Backend SQLite local.
        '/backend': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/backend/, ''),
        },

        // Dolibarr passe par le proxy plutôt que d'être appelé en direct.
        //
        // Deux raisons, toutes deux constatées sur l'instance de développement :
        // le navigateur rejetait les réponses en ERR_CONTENT_DECODING_FAILED,
        // parce que les avertissements PHP sont écrits avant la compression et
        // corrompent le flux gzip ; et un `header()` appelé après ces mêmes
        // avertissements échoue, ce qui pouvait faire sauter les en-têtes CORS
        // et provoquer des « Failed to fetch ».
        //
        // En passant par le proxy, les appels deviennent same-origin (plus de
        // CORS) et `Accept-Encoding: identity` supprime la compression, donc le
        // problème de décodage.
        '/dolibarr': {
          target: dolibarrTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/dolibarr/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Accept-Encoding', 'identity')
            })
          },
        },
      },
    },
  }
})
