// Prints its argv (after the script path) as JSON: proves each argument arrives as exactly one argv item.
process.stdout.write(JSON.stringify(process.argv.slice(2)))
