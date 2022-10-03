#!/usr/bin/env npx ts-node

import { Octokit } from "octokit"
import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { parse } from 'node-html-parser'
import fetch from 'node-fetch'
import querystring from 'query-string'
import { findPackageOrRequirements, getStarredRepos } from "./starcrossed";
const { Input, Confirm, MultiSelect } = require('enquirer');

dotenv.config()

const askUsePackage = new Confirm({
    name: 'existingPackage',
    message: 'An existing file was detected in your current folder. Would you like to use it?'
})
const askLocation = new Input({
    name: 'location',
    message: 'What is the absolute path of your dependencies file?',
    validate(value: string) {
        return value ? true : `Please enter the absolute path.`
    },
})
const askUsername = new Input({
    name: 'username',
    message: 'Please provide your GitHub username.',
    validate(value: string) {
        return value ? true : `Please enter your username.`
    },
})
const askPermission = new Confirm({
    name: 'question',
    message: 'Would you like to confirm each package before starring?'
})
const askToken = new Input({
    name: 'token',
    message: 'You do not seem to have a GITHUB_TOKEN specified in your environment variables. Please provide one in a .env file or enter it here.'
})

const askLanguage = new MultiSelect({
    name: 'language',
    message: 'Are you looking for package.json or requirements.txt?',
    validate(value: string[]) {
        return value.length === 0 ? `Select at least one option.` : true;
    },
    limit: 2,
    choices: [
        { name: 'package.json', value: '#00ffff' },
        { name: 'requirements.txt', value: '#000000' },
    ]
})

const main = async () => {
    try {
        const language = await askLanguage.run()
        const username = await askUsername.run()
        const perm: boolean = await askPermission.run()
        let GITHUB_TOKEN = process.env.GITHUB_TOKEN
        if(!GITHUB_TOKEN) {
            GITHUB_TOKEN = await askToken.run()
        }
        const octokit = new Octokit({
            auth: process.env.GITHUB_TOKEN,
        })
        let absolutePath = findPackageOrRequirements(process.cwd(), language)
        if (absolutePath) {
            const usePackage = await askUsePackage.run()
            if (!usePackage) {
                absolutePath = await askLocation.run();
            }
        } else {
            absolutePath = await askLocation.run();
        }
        let fileContents = readFileSync(absolutePath)
        let packageList: string[] = []
        if (absolutePath.includes('.json')) {
            const parsedJson = JSON.parse(String(fileContents));
            const dependencies = Object.keys(parsedJson.dependencies)
            const devDependencies = Object.keys(parsedJson.devDependencies)
            const npmPackages: string[] = [];
            dependencies.forEach(dependencies => {
                npmPackages.push(`https://www.npmjs.com/package/${dependencies}`)
            })
            devDependencies.forEach(devDependency => {
                npmPackages.push(`https://www.npmjs.com/package/${devDependency}`)
            })
            const npmPackagefmt = npmPackages.map(async (dependency: string) => {
                const response = await fetch(dependency);
                const text = await response.text();
                const html = parse(text);
                return html.querySelector('#repository-link')!.text.replace('github.com/', '')
            })
            packageList = await Promise.all(npmPackagefmt);
        }
        if (absolutePath.includes('.txt')) {
            const textSplit = fileContents.toString().split("\n");
            const pypiPackages = textSplit.map((requirement) => {
                const equals = requirement.indexOf('=')
                const equalToEnd = requirement.substring(equals, requirement.length)
                requirement = requirement.replace(equalToEnd, '')
                return requirement
            })
            const pipPackagefmt = pypiPackages.map(async(pipPackage) => {
                const pipName = `https://pypi.org/project/${pipPackage}`
                const response = await fetch(`https://pypi.org/project/${pipPackage}`);
                const text = await response.text();
                const html = parse(text);
                const github = html.querySelector('.github-repo-info')?.getAttribute('data-url')
                if (github) return github.replace('https://api.github.com/repos/', '')
                const queryString = querystring.stringify({
                    q: `${pipName.replace('https://pypi.org/project/', '')} in:name`,
                    sort: 'stars',
                    order: 'desc',
                })
                const potentialGithub = await octokit.request(`GET /search/repositories?${queryString}`)
                console.log(potentialGithub)
                const potentialGithubUrl = potentialGithub.data.items[0].full_name
                return potentialGithubUrl
            })
            packageList =  await Promise.all(pipPackagefmt);
        }
        const starredRepos = await getStarredRepos(username, octokit)
        console.log(starredRepos)
        const gitHubUrls = packageList.map((dependency: string) => {
            return `https://github.com/${dependency}`
        })
        let filteredStarStatus = gitHubUrls.filter(repo => repo !== undefined)
        const removeDuplicate = [...new Set(filteredStarStatus)]
        filteredStarStatus = Array.from(removeDuplicate)
        const getUnstarredRepos = filteredStarStatus.map((dependency: string, idx: number) => {
            if (starredRepos.includes(dependency!)) {
                console.log(packageList[idx])
                console.log(`You have already starred ${packageList[idx]}`)
            } else {
                console.log(`You have yet to star ${packageList[idx]}`)
                return dependency;
            }
        })
        for (const repo of getUnstarredRepos) {
            const authorSlashRepo = repo!.replace('https://github.com/', '')
            const split = authorSlashRepo.split('/')
            console.log(split)
            if (perm) {
              const askStar = new Confirm({
                name: 'question',
                message: `Would you like to star ${split[1]} by ${split[0]}`
              })
              const confirmation = await askStar.run()
              if (confirmation) {
                await octokit.request('PUT /user/starred/{owner}/{repo}', {
                  owner: split[0],
                  repo: split[1]
                })
                console.log(`Starred ${split[1]} by ${split[0]}`)
              }
            } else {
              await octokit.request('PUT /user/starred/{owner}/{repo}', {
                owner: split[0],
                repo: split[1]
              })
              console.log(`Starred ${split[1]} by ${split[0]}`)
            }
        }
    } catch {
        console.error
    }
}

main()