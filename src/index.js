// Load dependencies
const core = require('@actions/core');
const github = require('@actions/github');
const context = github.context;
const fetch = require('node-fetch');

/**
 * Internal dependencies.
 */
const utils = require('./utils');

/**
 * Types of contributions collected.
 *
 * @type {string[]}
 */
const contributorTypes = [
	'committers',
	'reviewers',
	'commenters',
	'reporters',
];

/**
 *
 * @type {*[]}
 */
const userData = [];

/**
 * A list of contributors grouped by the type of contribution.
 *
 * @type {*[]}
 */
const contributors = contributorTypes.reduce((acc, type) => {
	contributors[type] = new Set();
	return acc;
}, {});

async function run() {
	const octokit = github.getOctokit( core.getInput( 'token' ) );

	/*
	 * Fetch the following data for the pull request:
	 * - Commits with author details.
	 * - Reviews with author logins.
	 * - Comments with author logins.
	 * - Linked issues with author logins.
	 * - Comments on linked issues with author logins.
	 */
	const contributorData = await octokit.graphql(
		`query($owner:String!, $name:String!, $prNumber:Int!) {
			repository(owner:$owner, name:$name) {
				pullRequest(number:$prNumber) {
					commits(first: 100) {
						nodes {
							commit {
								author {
									user {
										databaseId
										login
										name
										email
									}
									name
									email
								}
							}
						}
					}
					reviews(first: 100) {
						nodes {
						  author {
							  login
						  }
						}
					}
					comments(first: 100) {
						nodes {
							author {
								login
							}
						}
					}
					closingIssuesReferences(first:100) {
						nodes {
							author {
								login
							}
							comments(first:100) {
								nodes {
									author {
										login
									}
								}
							}
						}
					}
				}
			}
		}`,
		{
			owner: context.repo.owner,
			name: context.repo.repo,
			prNumber: context.payload.pull_request.number,
		}
	);

	// Process pull request commits.
	for ( const commit of contributorData.repository.pullRequest.commits.nodes ) {
		/*
		 * Commits are sometimes made by an email that is not associated with a GitHub account.
		 * For these, info that may help us guess later.
		 */
		if ( null === commit.commit.author.user ) {
			contributors.committers.add( commit.commit.author.email );
			userData[ commit.commit.author.email ] = {
				name: commit.commit.author.name,
				email: commit.commit.author.email,
			};
		} else {
			if ( utils.skipUser( commit.commit.author.user.login ) ) {
				continue;
			}

			contributors.committers.add( commit.commit.author.user.login );
			userData[ commit.commit.author.user.login ] = commit.commit.author.user;
		}
	}

	// Process pull request reviews.
	contributorData.repository.pullRequest.reviews.nodes
		.filter(review => !utils.skipUser(review.author.login))
		.forEach(review => contributors.reviewers.add(review.author.login));

	// Process pull request comments.
	contributorData.repository.pullRequest.comments.nodes
		.filter(comment => !utils.skipUser(comment.author.login))
		.forEach(comment => contributors.commenters.add(comment.author.login));

	// Process reporters and commenters for linked issues.
	for ( const linkedIssue of contributorData.repository.pullRequest.closingIssuesReferences.nodes ) {
		if ( ! utils.skipUser( linkedIssue.author.login ) ) {
			contributors.reporters.add( linkedIssue.author.login );
		}

		for ( const issueComment of linkedIssue.comments.nodes ) {
			if ( utils.skipUser( issueComment.author.login ) ) {
				continue;
			}

			contributors.commenters.add( issueComment.author.login );
		}
	}

	// We already have user info for committers, we need to grab it for everyone else.
	if (
		[
			...contributors.reviewers,
			...contributors.commenters,
			...contributors.reporters,
		].length > 0
	) {
		const userData = await github.graphql(
			'{' +
				[
					...contributors.reviewers,
					...contributors.commenters,
					...contributors.reporters,
				].map(
					( user ) =>
						utils.escapeForGql( user ) +
						`: user(login: "${ user }") {databaseId, login, name, email}`
				) +
				'}'
		);

		Object.values( userData ).forEach( ( user ) => {
			userData[ user.login ] = user;
		});
	}

	console.debug( contributors );

	// Collect WordPress.org usernames
	const dotorgGHApi = 'https://profiles.wordpress.org/wp-json/wporg-github/v1/lookup/';

	const githubUsers = [];

	Object.keys(contributors).forEach((key) => {
		contributors[key].forEach((contributor) => {
			githubUsers.push(contributor);
		});
	});

	await fetch( dotorgGHApi, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ github_user: githubUsers }),
	})
		.then( ( response ) => response.json() )
		.then( ( data ) => {
			console.log(data);

			// Add each contributor's wp.org username to their user data.
			Object.keys(userData).forEach((contributor) => {
				if ( Object.prototype.hasOwnProperty.call( data, contributor ) && data[contributor] !== false ) {
					userData[ contributor ].dotOrg = data[contributor].slug;
				}
			});
		});

	const unconnectedUsers = [];

	return contributorTypes.map( ( priority ) => {
		// Skip an empty set of contributors.
		if ( contributors[ priority ].length === 0 ) {
			return [];
		}

		// Add a header for each section.
		const header =
			'# ' +
			priority.replace( /^./, ( char ) => char.toUpperCase() ) +
			'\n';

		// Generate each props entry, and join them into a single string.
		return (
			header +
			[ ...contributors[ priority ] ]
			.map( ( username ) => {
				const {
					dotOrg
				} = userData[ username ];

				if ( ! Object.prototype.hasOwnProperty.call( userData[ username ], 'dotOrg' ) ) {
					unconnectedUsers.push( username );
					return;
				}

				return `Co-authored-by: ${ username } <${ dotOrg }@git.wordpress.org>`;
			})
			.join( '\n' )
		);
	})
	.join( '\n\n' );
}

run();
