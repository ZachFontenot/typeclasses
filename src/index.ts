import * as A from 'fp-ts/Array'
import { flow, pipe } from 'fp-ts/function'
import * as O from 'fp-ts/Option'
import { concatAll, Semigroup } from 'fp-ts/Semigroup'
import { Eq } from 'fp-ts/String'
import * as T from 'fp-ts/Task'
import * as TE from 'fp-ts/TaskEither'
import { Artist, spotifyClient } from './spotify'
import * as data from '../env.json'

const SPOTIFY_CLIENT_ID = data.clientId
const SPOTIFY_CLIENT_SECRET = data.clientSecret

const semigroupIntersection: Semigroup<string[]> = {
  concat: (x, y) => A.intersection(Eq)(x)(y) // removed dupes essentially
}

const semigroupAll: Semigroup<string[]> = {
  concat: (x, y) => [...x, ...y]
}

const all = concatAll(semigroupAll)

const intersect = concatAll(semigroupIntersection)

const artistIntersection = flow(
  (relatedLists: readonly string[][]) => pipe(
    relatedLists,
    all([]),
    (a) => intersect(a)(relatedLists)))

type C = ReturnType<typeof spotifyClient>

const getArtistInfo = (client: C) => (artist: string) =>
  pipe(
    client,
    TE.chain((client) => client.searchArtist(artist)), // searchArtist: () => TaskEither<E, Some Shit>
    TE.map((result) => A.head(result.artists.items)), // We have a TaskEither and we'd like to return the head of this list.
    TE.chain(TE.fromOption(() => new Error(`No matching artist found for: ${artist}`))) // No errors?
  )

const getRelated = (client: C) => (artist: Artist) =>
  pipe(
    client,
    TE.chain((client) => client.relatedArtist(artist.id)),
    TE.map((related) => ({
      artist: artist,
      related: related.artists.map((artist) => artist.name)
    }))
  )

const runCall = (client: C) => (artist: string) =>
  pipe(
    getArtistInfo(client)(artist),
    TE.chain((a) => getRelated(client)(a))
  )

const creds =  { clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET }

const main = (artists: string[]) =>
  pipe(
    creds,
    spotifyClient,
    runCall,
    (getRelated) => pipe(artists, A.traverse(TE.taskEither)(getRelated)),
    TE.map((a) => ({
      artists: a.map((i) => i.artist.name),
      related: artistIntersection(a.map((i) => i.related)),
    })),
    TE.map((a) => `Artists related to ${a.artists.join(' & ')}: \n${a.related.join('\n')}`),
    TE.fold(
      (e) => T.of(console.error(e)),
      (a) => T.of(console.log(a)),
    ),
  );

const getNames = pipe(process.argv, (args) => args.slice(2))

main(getNames)().then()
