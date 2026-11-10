

const CLIENT_ID = "801579d3b1ba42eba6a12370d3f6831b";

const REDIRECT_URI = "https://miguelpd250-cmd.github.io/nextege/";

const SCOPES = "user-read-currently-playing";

const conectar = document.getElementById("conectar");

let accessToken = null;
let duracaoMusica = 0;
let progressoMusica = 0;
let ultimaSincronizacao = Date.now();
let estaTocando = false;

// Gerar código aleatório
function gerarCodigo(tamanho = 64) {
    const caracteres = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const valores = crypto.getRandomValues(new Uint8Array(tamanho));

    return Array.from(valores, valor =>
        caracteres[valor % caracteres.length]
    ).join("");
}

// Converter para Base64 URL
function base64URL(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

// Criar desafio PKCE
async function criarChallenge(verifier) {
    const dados = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", dados);

    return base64URL(hash);
}

// CONECTAR AO SPOTIFY
async function loginSpotify() {

    const verifier = gerarCodigo();
    const challenge = await criarChallenge(verifier);
    const state = gerarCodigo(32);

    localStorage.setItem("spotify_verifier", verifier);
    localStorage.setItem("spotify_state", state);

    const parametros = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge_method: "S256",
        code_challenge: challenge,
        state: state
    });

    window.location.href =
        "https://accounts.spotify.com/authorize?" +
        parametros.toString();
}

// RECEBER AUTORIZAÇÃO
async function receberAutorizacao() {

    const url = new URLSearchParams(window.location.search);

    const code = url.get("code");
    const state = url.get("state");
    const error = url.get("error");

    if (error) {
        document.getElementById("status").textContent =
            "Autorização não concedida.";
        return;
    }

    if (!code) return;

    const verifier = localStorage.getItem("spotify_verifier");
    const stateSalvo = localStorage.getItem("spotify_state");

    if (!verifier || state !== stateSalvo) {
        document.getElementById("status").textContent =
            "Erro de segurança na autenticação.";
        return;
    }

    localStorage.removeItem("spotify_state");

    const resposta = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "authorization_code",
                code: code,
                redirect_uri: REDIRECT_URI,
                code_verifier: verifier
            })
        }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
        throw new Error(dados.error_description || "Erro ao conectar.");
    }

    salvarTokens(dados);

    localStorage.removeItem("spotify_verifier");

    // Remover o código da URL
    history.replaceState({}, document.title, REDIRECT_URI);

    document.getElementById("status").textContent =
        "Spotify conectado!";

    await atualizarMusica();
}

// SALVAR TOKENS
function salvarTokens(dados) {

    localStorage.setItem("spotify_access_token", dados.access_token);

    if (dados.refresh_token) {
        localStorage.setItem("spotify_refresh_token", dados.refresh_token);
    }

    localStorage.setItem(
        "spotify_expira",
        Date.now() + dados.expires_in * 1000
    );

    accessToken = dados.access_token;
}

// RENOVAR TOKEN
async function renovarToken() {

    const refreshToken = localStorage.getItem("spotify_refresh_token");

    if (!refreshToken) {
        throw new Error("Faça login novamente no Spotify.");
    }

    const resposta = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "refresh_token",
                refresh_token: refreshToken
            })
        }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
        throw new Error("Não foi possível renovar o acesso.");
    }

    salvarTokens(dados);
}

// PEGAR TOKEN VÁLIDO
async function pegarToken() {

    accessToken = localStorage.getItem("spotify_access_token");

    const expira = Number(localStorage.getItem("spotify_expira"));

    if (!accessToken || Date.now() > expira - 60000) {
        await renovarToken();
    }

    return accessToken;
}

// FORMATAR TEMPO
function formatarTempo(ms) {

    const segundos = Math.floor(ms / 1000);
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;

    return (
        String(minutos).padStart(2, "0") +
        ":" +
        String(resto).padStart(2, "0")
    );
}

// ATUALIZAR MÚSICA
async function atualizarMusica() {

    try {

        const token = await pegarToken();

        const resposta = await fetch(
            "https://api.spotify.com/v1/me/player/currently-playing",
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        if (resposta.status === 401) {
            await renovarToken();
            return atualizarMusica();
        }

        if (resposta.status === 204) {
            document.getElementById("nome-musica").textContent =
                "Nenhuma música tocando";

            document.getElementById("artista").textContent =
                "Spotify conectado";

            document.getElementById("status").textContent =
                "Aguardando reprodução...";

            barra.style.width = "0%";
            return;
        }

        if (!resposta.ok) {
            throw new Error("Erro ao consultar Spotify: " + resposta.status);
        }

        const dados = await resposta.json();
        const musica = dados.item;

        if (!musica) return;

        const imagens = musica.album?.images || musica.images || [];

        document.getElementById("nome-musica").textContent =
            musica.name;

        document.getElementById("artista").textContent =
            musica.artists
                ? musica.artists.map(a => a.name).join(", ")
                : "Podcast";

        if (imagens.length > 0) {
            document.getElementById("capa").src = imagens[0].url;
        }

        duracaoMusica = musica.duration_ms || 0;
        progressoMusica = dados.progress_ms || 0;
        ultimaSincronizacao = Date.now();
        estaTocando = dados.is_playing;

        document.getElementById("status").textContent =
            estaTocando ? "Tocando agora" : "Pausado";

        atualizarBarra();

    } catch (erro) {

        console.error(erro);

        document.getElementById("status").textContent =
            erro.message;
    }
}

// ATUALIZAR BARRA
function atualizarBarra() {

    if (estaTocando) {
        progressoMusica = Math.min(
            duracaoMusica,
            progressoMusica + (Date.now() - ultimaSincronizacao)
        );

        ultimaSincronizacao = Date.now();
    }

    const porcentagem = duracaoMusica
        ? (progressoMusica / duracaoMusica) * 100
        : 0;

    barra.style.width = porcentagem + "%";

    tempoAtual.textContent = formatarTempo(progressoMusica);
    duracao.textContent = formatarTempo(duracaoMusica);
}

// BOTÃO DE CONEXÃO
conectar.addEventListener("click", loginSpotify);

// INICIAR
(async function iniciar() {

    try {

        await receberAutorizacao();

        if (localStorage.getItem("spotify_access_token")) {

            document.getElementById("status").textContent =
                "Spotify conectado!";

            await atualizarMusica();

        }

    } catch (erro) {

        console.error(erro);

        document.getElementById("status").textContent =
            erro.message;
    }

})();

// Atualizar o progresso a cada segundo
setInterval(atualizarBarra, 1000);

// Consultar Spotify a cada 10 segundos
setInterval(() => {
    if (localStorage.getItem("spotify_access_token")) {
        atualizarMusica();
    }
}, 10000);

const barra = document.getElementById("barra");
const tempoAtual = document.getElementById("tempo-atual");
const duracao = document.getElementById("duracao");

