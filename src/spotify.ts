import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import * as A from 'fp-ts/Array'
import * as E from 'fp-ts/Either'
import { flow, identity, pipe } from 'fp-ts/function'
import * as TE from 'fp-ts/TaskEither'
import * as t from 'io-ts'
import { base64Encode } from './utils'

type Creds = { clientId: string, clientSecret: string}

const apiUrl = 'https://api.spotify.com/v1/'

interface Test {
  thing: string
  ping: string
  pong: number
}

const tokenCodec = t.type({
  access_token: t.string,
  token_type: t.string,
  expires_in: t.number,
})

const artistCodec = t.type({
  name: t.string,
  id: t.string,
})

export type Artist = t.TypeOf<typeof artistCodec>

const artistsCodec = t.type({
  items: t.array(artistCodec),
})

export type Artists = t.TypeOf<typeof artistsCodec>

const artistsResponseCodec = t.type({
  artists: artistsCodec,
})

export type ArtistResponse = t.TypeOf<typeof artistsResponseCodec>

const relatedResponseCodec = t.type({
  artists: t.array(artistCodec),
})

const makeReq = TE.bimap(
  (e: unknown) => (e instanceof Error ? e : new Error(String(e))), // Either Left<e> | Right<A>
  (v: AxiosResponse): unknown => v.data
)

export const httpGet = flow(TE.tryCatchK(axios.get, identity), makeReq)

export const httpPost = flow(TE.tryCatchK(axios.post, identity), makeReq)

const validateJson = <R extends t.Props>(decoder: t.TypeC<R>) =>
  flow(
    (json: unknown) => json,
    decoder.decode,
    (v) => E.Functor.map(v, (artist) => artist),
    E.mapLeft((errors) => new Error(errors.map((error) => error.context.map(({ key }) => key).join('.')).join('\n')))
  )

export const getAuth = flow(
  (c: Creds) => `${c.clientId}:${c.clientSecret}`,
  base64Encode,
  (token: string) =>
    httpPost('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: { Authorization: `Basic ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    }),
  TE.chain((a) => TE.fromEither(validateJson(tokenCodec)(a)))
)

export const spotifyClient = (creds: { clientId: string; clientSecret: string }) =>
  pipe(
    getAuth(creds),
    TE.map((authResult) => <R extends t.Props>(uri: string, decoder: t.TypeC<R>) =>
      pipe(httpGet(uri, { headers: { Authorization: `Bearer ${authResult.access_token}` } }), TE.chain(flow(validateJson(decoder), TE.fromEither))),
    ),
    TE.map((client) => ({
      searchArtist: (name: string) => client(`https://api.spotify.com/v1/search?q=${name}&type=artist`, artistsResponseCodec),
      relatedArtist: (id: string) => client(`https://api.spotify.com/v1/artists/${id}/related-artists`, relatedResponseCodec),
    })),
  );
