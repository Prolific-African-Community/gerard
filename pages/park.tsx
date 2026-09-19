import type { GetServerSideProps } from 'next'

export default function ParkRedirect() {
  return null
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/dispatch?view=park', permanent: false },
})
